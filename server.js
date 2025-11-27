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
    // Extrair o tipo MIME e os dados base64
    const matches = fotoBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Formato de imagem base64 inválido');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const extension = mimeType.split('/')[1];
    
    // Criar buffer a partir dos dados base64
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Nome do arquivo único usando CPF e matrícula
    const fileName = `foto-${cpf}-${matricula}-${Date.now()}.${extension}`;
    const filePath = `funcionarios/${fileName}`;

    // Fazer upload para o Supabase Storage
    const { data, error } = await supabase.storage
      .from('fotos-funcionarios')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Obter URL pública da imagem
    const { data: { publicUrl } } = supabase.storage
      .from('fotos-funcionarios')
      .getPublicUrl(filePath);

    return publicUrl;

  } catch (error) {
    console.error('Erro no upload da foto:', error);
    throw new Error(`Falha no upload da foto: ${error.message}`);
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

    // Verificar se o CPF já existe no banco de dados
    const { data: existingFuncionario, error: queryError } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('cpf', cpf)
      .single();

    if (queryError && queryError.code !== 'PGRST116') { // PGRST116 = não encontrado
      console.error('Erro ao consultar CPF:', queryError);
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

    // Simulação de consulta a API externa de CPF
    const dadosCPF = await consultarAPIExternaCPF(cpf);

    if (dadosCPF) {
      return res.json({
        success: true,
        data: dadosCPF
      });
    } else {
      return res.json({
        success: false,
        error: 'CPF não encontrado na base de dados externa',
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

// Função para simular consulta a API externa de CPF
async function consultarAPIExternaCPF(cpf) {
  try {
    // EM PRODUÇÃO: Substituir por chamada real para API de consulta de CPF
    // Exemplo: Receita WS, Serpro, ou outra API oficial
    
    // Simulação de delay de rede
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Dados mockados para demonstração
    // Em produção, isso viria da API real
    const dadosMockados = {
      nome: "FULANO DA SILVA",
      data_nascimento: "15/03/1985",
      sexo: "M"
    };

    // Simulação: retorna dados apenas para CPFs específicos para demonstração
    const cpfsComDados = [
      '12345678909',
      '98765432100',
      '11122233344'
    ];

    if (cpfsComDados.includes(cpf)) {
      return dadosMockados;
    }

    // Para outros CPFs, simula que não encontrou dados
    return null;

  } catch (error) {
    console.error('Erro na API externa de CPF:', error);
    return null;
  }
}

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
        // Não impedir o cadastro se houver erro na foto
        // Apenas registrar o erro e continuar sem foto
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
      foto_url: fotoUrl, // URL da foto no Storage
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
      foto_url: fotoUrl // Retornar também a URL da foto
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

    // Adicionar URL da foto se foi feito upload
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
  console.log(`🖼️  Storage de fotos: fotos-funcionarios`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
