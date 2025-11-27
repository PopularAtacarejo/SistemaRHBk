const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Supabase
const SUPABASE_URL = "https://tmgglppfobyoosfiewoa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZ2dscHBmb2J5b29zZmlld29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3Mjg4NTEsImV4cCI6MjA3OTMwNDg1MX0.DH3IyjnE7zztySzyckKREy5Zlgmg2aJe4TEXIbmFmkA";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Backend do Sistema RH está funcionando!',
    timestamp: new Date().toISOString()
  });
});

// Função para upload de foto para o Supabase Storage
async function uploadFotoParaStorage(fotoBase64, cpf, matricula) {
  try {
    const matches = fotoBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Formato de imagem base64 inválido');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const extension = mimeType.split('/')[1];
    
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `foto-${cpf}-${matricula}-${Date.now()}.${extension}`;
    const filePath = `funcionarios/${fileName}`;

    const { data, error } = await supabase.storage
      .from('fotos-funcionarios')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('fotos-funcionarios')
      .getPublicUrl(filePath);

    return publicUrl;

  } catch (error) {
    console.error('Erro no upload da foto:', error);
    throw new Error(`Falha no upload da foto: ${error.message}`);
  }
}

// Função para consulta real na API de CPF
async function consultarAPIExternaCPF(cpf) {
  try {
    // Limpa formatação para envio
    const cpfClean = cpf.replace(/\D/g, '');
    
    const url = `https://apicpf.com/api/consulta?cpf=${cpfClean}`;
    const headers = {
      "X-API-KEY": "7616f38484798083668eea3d51d986edeec5c20a93c24a7aea49cc3f0697c929"
    };

    console.log(`Consultando CPF na API: ${cpfClean}`);
    
    const response = await fetch(url, { 
      headers: headers,
      timeout: 15000 
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Resposta completa da API CPF:', result);

    // Verifica se a API retornou dados válidos
    if (result && result.code === 200 && result.data && result.data.nome) {
      const data = result.data;
      
      // Formata a data de nascimento para DD/MM/AAAA
      let dataNascimento = data.data_nascimento;
      if (dataNascimento && dataNascimento.includes('-')) {
        const [ano, mes, dia] = dataNascimento.split('-');
        dataNascimento = `${dia}/${mes}/${ano}`;
      }

      // Mapeia 'genero' para 'sexo'
      let sexo = data.genero;
      if (sexo === 'M') sexo = 'M';
      else if (sexo === 'F') sexo = 'F';

      return {
        nome: data.nome,
        data_nascimento: dataNascimento,
        sexo: sexo
      };
    } else {
      // Se a API não retornou nome, considera que não encontrou
      console.log('CPF não encontrado na API');
      return null;
    }

  } catch (error) {
    console.error('Erro na API externa de CPF:', error);
    return null;
  }
}

// Consulta de CPF
app.post('/api/consultar-cpf', async (req, res) => {
  try {
    const { cpf } = req.body;

    if (!cpf) {
      return res.status(400).json({
        success: false,
        error: 'CPF é obrigatório'
      });
    }

    // Verificar se o CPF já existe no banco de dados (para evitar duplicação)
    const { data: existingFuncionario, error: queryError } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('cpf', cpf.replace(/\D/g, ''))
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('Erro ao consultar CPF no banco:', queryError);
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao consultar CPF'
      });
    }

    if (existingFuncionario) {
      return res.json({
        success: false,
        error: 'CPF já cadastrado no sistema',
        cpf_existente: true,
        data: null
      });
    }

    // Consulta REAL na API externa de CPF
    const dadosCPF = await consultarAPIExternaCPF(cpf);

    if (dadosCPF) {
      return res.json({
        success: true,
        data: dadosCPF
      });
    } else {
      return res.json({
        success: false,
        error: 'CPF não encontrado na base de dados oficial',
        cpf_existente: false
      });
    }

  } catch (error) {
    console.error('Erro na consulta de CPF:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 🔍 CONSULTA CNPJ
// ===================================================================

// Função para consultar CNPJ na API open.cnpja.com
async function consultarAPIExternaCNPJ(cnpj) {
  try {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    
    if (cnpjLimpo.length !== 14) {
      throw new Error("CNPJ deve conter 14 dígitos!");
    }
    
    const url = `https://open.cnpja.com/office/${cnpjLimpo}`;
    
    console.log(`Consultando CNPJ na API: ${cnpjLimpo}`);
    
    const response = await fetch(url, { timeout: 10000 });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Resposta completa da API CNPJ:', result);

    return result;

  } catch (error) {
    console.error('Erro na API externa de CNPJ:', error);
    throw new Error(`Erro na consulta CNPJ: ${error.message}`);
  }
}

// Rota para consultar CNPJ
app.post('/api/consultar-cnpj', async (req, res) => {
  try {
    const { cnpj } = req.body;

    if (!cnpj) {
      return res.status(400).json({
        success: false,
        error: 'CNPJ é obrigatório'
      });
    }

    // Verificar se o CNPJ já existe no banco de dados
    const { data: existingEmpresa, error: queryError } = await supabase
      .from('empresas')
      .select('*')
      .eq('cnpj', cnpj.replace(/\D/g, ''))
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('Erro ao consultar CNPJ no banco:', queryError);
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao consultar CNPJ'
      });
    }

    if (existingEmpresa) {
      return res.json({
        success: false,
        error: 'CNPJ já cadastrado no sistema',
        cnpj_existente: true,
        data: null
      });
    }

    // Consulta na API externa de CNPJ
    const dadosCNPJ = await consultarAPIExternaCNPJ(cnpj);

    if (dadosCNPJ) {
      return res.json({
        success: true,
        data: dadosCNPJ
      });
    } else {
      return res.json({
        success: false,
        error: 'CNPJ não encontrado na base de dados oficial',
        cnpj_existente: false
      });
    }

  } catch (error) {
    console.error('Erro na consulta de CNPJ:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 💼 CADASTRO DE EMPRESAS
// ===================================================================

// Rota para cadastrar empresa
app.post('/api/empresas', async (req, res) => {
  try {
    const empresaData = req.body;

    // Validar campos obrigatórios
    const camposObrigatorios = ['CNPJ', 'NOME_FANTASIA', 'RAZAO_SOCIAL'];
    const camposFaltantes = camposObrigatorios.filter(campo => !empresaData[campo]);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    // Verificar se CNPJ já existe
    const { data: existingEmpresa, error: checkError } = await supabase
      .from('empresas')
      .select('cnpj')
      .eq('cnpj', empresaData.CNPJ)
      .single();

    if (existingEmpresa) {
      return res.status(400).json({
        success: false,
        error: 'CNPJ já cadastrado no sistema'
      });
    }

    // Preparar dados para inserção
    const dadosInserir = {
      cnpj: empresaData.CNPJ,
      nome_fantasia: empresaData.NOME_FANTASIA,
      razao_social: empresaData.RAZAO_SOCIAL,
      data_abertura: empresaData.DATA_ABERTURA,
      situacao: empresaData.SITUACAO,
      data_situacao: empresaData.DATA_SITUACAO,
      natureza_juridica: empresaData.NATUREZA_JURIDICA,
      capital_social: empresaData.CAPITAL_SOCIAL,
      porte: empresaData.PORTE,
      simples: empresaData.SIMPLES,
      mei: empresaData.MEI,
      tipo_empresa: empresaData.TIPO_EMPRESA,
      end_cep: empresaData.END_CEP,
      end_logradouro: empresaData.END_LOGRADOURO,
      end_numero: empresaData.END_NUMERO,
      end_bairro: empresaData.END_BAIRRO,
      end_cidade: empresaData.END_CIDADE,
      end_estado: empresaData.END_ESTADO,
      end_complemento: empresaData.END_COMPLEMENTO,
      telefone1: empresaData.TELEFONE1,
      telefone2: empresaData.TELEFONE2,
      email: empresaData.EMAIL,
      cnae_principal: empresaData.CNAE_PRINCIPAL,
      descricao_cnae_principal: empresaData.DESCRICAO_CNAE_PRINCIPAL,
      cnaes_secundarios: empresaData.CNAES_SECUNDARIOS,
      data_criacao: new Date().toISOString()
    };

    // Inserir no Supabase
    const { data, error } = await supabase
      .from('empresas')
      .insert([dadosInserir])
      .select();

    if (error) {
      console.error('Erro ao inserir empresa:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao cadastrar empresa no banco de dados'
      });
    }

    return res.json({
      success: true,
      message: 'Empresa cadastrada com sucesso!',
      data: data[0]
    });

  } catch (error) {
    console.error('Erro no cadastro de empresa:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 📋 LISTAGEM DE EMPRESAS
// ===================================================================

// Rota para listar empresas
app.get('/api/empresas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('empresas')
      .select('*')
      .order('data_criacao', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar empresas'
    });
  }
});

// Rota para buscar empresa por ID
app.get('/api/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    res.status(500).json({
      success: false,
      error: 'Empresa não encontrada'
    });
  }
});
// Cadastro de funcionário
app.post('/api/funcionarios', async (req, res) => {
  try {
    const funcionarioData = req.body;

    // Validar campos obrigatórios
    const camposObrigatorios = ['NOME', 'CPF', 'EMPRESA', 'SETOR', 'FUNCAO', 'MATRICULA', 'ADMISSAO'];
    const camposFaltantes = camposObrigatorios.filter(campo => !funcionarioData[campo]);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    // Verificar se CPF já existe
    const { data: existingFuncionario, error: checkError } = await supabase
      .from('funcionarios')
      .select('cpf')
      .eq('cpf', funcionarioData.CPF)
      .single();

    if (existingFuncionario) {
      return res.status(400).json({
        success: false,
        error: 'CPF já cadastrado no sistema'
      });
    }

    // Processar foto se existir
    let fotoUrl = null;
    if (funcionarioData.FOTO) {
      try {
        fotoUrl = await uploadFotoParaStorage(
          funcionarioData.FOTO, 
          funcionarioData.CPF, 
          funcionarioData.MATRICULA
        );
        console.log('Foto uploadada com sucesso:', fotoUrl);
      } catch (uploadError) {
        console.error('Erro no upload da foto:', uploadError);
      }
    }

    // Preparar dados para inserção
    const dadosInserir = {
      nome: funcionarioData.NOME,
      cpf: funcionarioData.CPF,
      data_nascimento: funcionarioData.NASC,
      naturalidade: funcionarioData.NATURALIDADE,
      sexo: funcionarioData.SEXO,
      rg: funcionarioData.RG,
      pis: funcionarioData.PIS,
      empresa: funcionarioData.EMPRESA,
      setor: funcionarioData.SETOR,
      funcao: funcionarioData.FUNCAO,
      cbo: funcionarioData.CBO,
      matricula: funcionarioData.MATRICULA,
      data_admissao: funcionarioData.ADMISSAO,
      salario: funcionarioData.SALARIO,
      secao: funcionarioData.SECAO,
      lider_responsavel: funcionarioData.LIDER_RESPONSAVEL,
      is_lider: funcionarioData.IS_LIDER,
      is_pai_mae: funcionarioData.IS_PAI_MAE,
      num_filhos: funcionarioData.NUM_FILHOS,
      cep: funcionarioData.END_CEP,
      rua: funcionarioData.END_RUA,
      numero: funcionarioData.END_NUMERO,
      bairro: funcionarioData.END_BAIRRO,
      cidade: funcionarioData.END_CIDADE,
      estado: funcionarioData.END_ESTADO,
      complemento: funcionarioData.END_COMPLEMENTO,
      tamanho_fardamento: funcionarioData.TAMANHO_FARDAMENTO,
      foto_url: fotoUrl,
      data_criacao: new Date().toISOString()
    };

    // Adicionar dados dos filhos se existirem
    for (let i = 1; i <= 5; i++) {
      const campoFilho = `NASC_FILHO_${i}`;
      if (funcionarioData[campoFilho]) {
        dadosInserir[`data_nasc_filho_${i}`] = funcionarioData[campoFilho];
      }
    }

    // Inserir no Supabase
    const { data, error } = await supabase
      .from('funcionarios')
      .insert([dadosInserir])
      .select();

    if (error) {
      console.error('Erro ao inserir funcionário:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao cadastrar funcionário no banco de dados'
      });
    }

    return res.json({
      success: true,
      message: 'Funcionário cadastrado com sucesso!',
      data: data[0],
      foto_url: fotoUrl
    });

  } catch (error) {
    console.error('Erro no cadastro de funcionário:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar funcionário
app.put('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const funcionarioData = req.body;

    // Processar foto se existir
    let fotoUrl = null;
    if (funcionarioData.FOTO && funcionarioData.FOTO.startsWith('data:image')) {
      try {
        fotoUrl = await uploadFotoParaStorage(
          funcionarioData.FOTO, 
          funcionarioData.CPF, 
          funcionarioData.MATRICULA
        );
        funcionarioData.foto_url = fotoUrl;
      } catch (uploadError) {
        console.error('Erro no upload da foto:', uploadError);
      }
    }

    // Preparar dados para atualização
    const dadosAtualizar = {
      nome: funcionarioData.NOME,
      cpf: funcionarioData.CPF,
      data_nascimento: funcionarioData.NASC,
      naturalidade: funcionarioData.NATURALIDADE,
      sexo: funcionarioData.SEXO,
      rg: funcionarioData.RG,
      pis: funcionarioData.PIS,
      empresa: funcionarioData.EMPRESA,
      setor: funcionarioData.SETOR,
      funcao: funcionarioData.FUNCAO,
      cbo: funcionarioData.CBO,
      matricula: funcionarioData.MATRICULA,
      data_admissao: funcionarioData.ADMISSAO,
      salario: funcionarioData.SALARIO,
      secao: funcionarioData.SECAO,
      lider_responsavel: funcionarioData.LIDER_RESPONSAVEL,
      is_lider: funcionarioData.IS_LIDER,
      is_pai_mae: funcionarioData.IS_PAI_MAE,
      num_filhos: funcionarioData.NUM_FILHOS,
      cep: funcionarioData.END_CEP,
      rua: funcionarioData.END_RUA,
      numero: funcionarioData.END_NUMERO,
      bairro: funcionarioData.END_BAIRRO,
      cidade: funcionarioData.END_CIDADE,
      estado: funcionarioData.END_ESTADO,
      complemento: funcionarioData.END_COMPLEMENTO,
      tamanho_fardamento: funcionarioData.TAMANHO_FARDAMENTO,
      data_atualizacao: new Date().toISOString()
    };

    if (fotoUrl) {
      dadosAtualizar.foto_url = fotoUrl;
    }

    // Adicionar dados dos filhos
    for (let i = 1; i <= 5; i++) {
      const campoFilho = `NASC_FILHO_${i}`;
      if (funcionarioData[campoFilho]) {
        dadosAtualizar[`data_nasc_filho_${i}`] = funcionarioData[campoFilho];
      }
    }

    // Atualizar no Supabase
    const { data, error } = await supabase
      .from('funcionarios')
      .update(dadosAtualizar)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao atualizar funcionário:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar funcionário'
      });
    }

    return res.json({
      success: true,
      message: 'Funcionário atualizado com sucesso!',
      data: data[0],
      foto_url: fotoUrl
    });

  } catch (error) {
    console.error('Erro na atualização de funcionário:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Listar funcionários
app.get('/api/funcionarios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('*')
      .order('data_criacao', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Erro ao listar funcionários:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar funcionários'
    });
  }
});

// Buscar funcionário por ID
app.get('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Erro ao buscar funcionário:', error);
    res.status(500).json({
      success: false,
      error: 'Funcionário não encontrado'
    });
  }
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
  console.log(`🔐 API CPF: Integrada com apicpf.com`);
  console.log(`🖼️  Storage de fotos: fotos-funcionarios`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
});

module.exports = app;

