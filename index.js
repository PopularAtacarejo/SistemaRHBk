const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Supabase
const SUPABASE_URL = "https://tmgglppfobyoosfiewoa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZ2dscHBmb2J5b29zZmlld29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3Mjg4NTEsImV4cCI6MjA3OTMwNDg1MX0.DH3IyjnE7zztySzyckKREy5Zlgmg2aJe4TEXIbmFmkA";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Backend do Sistema RH está funcionando!',
    timestamp: new Date().toISOString()
  });
});

// ===================================================================
// 🖼️ FUNÇÕES DE STORAGE (FOTOS)
// ===================================================================

async function uploadFotoParaStorage(fotoBase64, cpf, matricula) {
  try {
    console.log('📸 Iniciando upload de foto...');
    
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

    console.log(`📁 Uploading: ${fileName} (${buffer.length} bytes)`);

    const { data, error } = await supabase.storage
      .from('fotos-funcionarios')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      console.error('❌ Erro no upload da foto:', error);
      throw error;
    }

    console.log('✅ Upload concluído, obtendo URL pública...');

    const { data: { publicUrl } } = supabase.storage
      .from('fotos-funcionarios')
      .getPublicUrl(filePath);

    console.log(`🔗 URL da foto: ${publicUrl}`);
    return publicUrl;

  } catch (error) {
    console.error('❌ Erro no upload da foto:', error);
    throw new Error(`Falha no upload da foto: ${error.message}`);
  }
}

// ===================================================================
// 📁 FUNÇÕES DE STORAGE PARA ADVERTÊNCIAS
// ===================================================================

async function uploadArquivoParaStorage(file, prefixo, funcionarioId) {
  try {
    console.log(`📁 Iniciando upload de ${prefixo} para funcionário ${funcionarioId}...`);
    
    const fileName = `${prefixo}-${funcionarioId}-${Date.now()}.${file.originalname.split('.').pop()}`;
    const filePath = `advertencias/${funcionarioId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('arquivos-advertencias')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error(`❌ Erro no upload do arquivo ${prefixo}:`, error);
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('arquivos-advertencias')
      .getPublicUrl(filePath);

    console.log(`✅ Upload concluído: ${publicUrl}`);
    return publicUrl;

  } catch (error) {
    console.error(`❌ Erro no upload do arquivo:`, error);
    throw new Error(`Falha no upload do arquivo: ${error.message}`);
  }
}

// ===================================================================
// ⚠️ ROTAS PARA ADVERTÊNCIAS
// ===================================================================

// Criar advertência (com upload de arquivos)
app.post('/api/advertencias', upload.any(), async (req, res) => {
  try {
    console.log('📥 Recebendo dados para nova advertência...');
    
    // Extrair dados do FormData
    const dadosAdvertencia = JSON.parse(req.body.dados || '{}');
    const files = req.files || [];
    
    console.log('📋 Dados da advertência:', {
      funcionario_id: dadosAdvertencia.funcionario_id,
      tipo: dadosAdvertencia.tipo,
      aplicado_por: dadosAdvertencia.aplicado_por,
      arquivosRecebidos: files.length
    });

    // Validar campos obrigatórios
    const camposObrigatorios = ['funcionario_id', 'tipo', 'motivo', 'aplicado_por', 'data_advertencia'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosAdvertencia[campo]);
    
    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    // Verificar se funcionário existe
    const { data: funcionario, error: funcError } = await supabase
      .from('funcionarios')
      .select('id, nome, cpf, matricula, funcao, setor, empresa, data_admissao, foto_url')
      .eq('id', dadosAdvertencia.funcionario_id)
      .single();

    if (funcError || !funcionario) {
      console.error('❌ Funcionário não encontrado:', dadosAdvertencia.funcionario_id);
      return res.status(404).json({
        success: false,
        error: 'Funcionário não encontrado'
      });
    }

    // Processar arquivos
    const evidenciasUrls = [];
    let assinaturaUrl = null;

    for (const file of files) {
      try {
        if (file.fieldname.includes('evidencias')) {
          const url = await uploadArquivoParaStorage(file, 'evidencia', dadosAdvertencia.funcionario_id);
          evidenciasUrls.push(url);
          console.log(`✅ Evidência salva: ${url}`);
        } else if (file.fieldname === 'assinatura') {
          assinaturaUrl = await uploadArquivoParaStorage(file, 'assinatura', dadosAdvertencia.funcionario_id);
          console.log(`✅ Assinatura salva: ${assinaturaUrl}`);
        }
      } catch (uploadError) {
        console.error(`❌ Erro ao processar arquivo ${file.originalname}:`, uploadError);
      }
    }

    // Preparar dados para inserção
    const dadosInserir = {
      funcionario_id: dadosAdvertencia.funcionario_id,
      funcionario_nome: funcionario.nome,
      funcionario_cpf: funcionario.cpf,
      funcionario_matricula: funcionario.matricula,
      funcionario_funcao: funcionario.funcao,
      funcionario_setor: funcionario.setor,
      funcionario_empresa: funcionario.empresa,
      funcionario_foto: funcionario.foto_url,
      tipo: dadosAdvertencia.tipo,
      motivo: dadosAdvertencia.motivo,
      aplicado_por: dadosAdvertencia.aplicado_por,
      data_advertencia: dadosAdvertencia.data_advertencia,
      validade_meses: dadosAdvertencia.validade_meses || 6,
      observacoes: dadosAdvertencia.observacoes || '',
      status: 'ATIVA',
      evidencias_url: evidenciasUrls.length > 0 ? evidenciasUrls : null,
      assinatura_url: assinaturaUrl,
      data_criacao: new Date().toISOString()
    };

    // Inserir no banco
    const { data, error } = await supabase
      .from('advertencias')
      .insert([dadosInserir])
      .select();

    if (error) {
      console.error('❌ Erro ao inserir advertência:', error);
      
      // Se a tabela não existir, retornar erro específico
      if (error.code === '42P01') {
        return res.status(500).json({
          success: false,
          error: 'Tabela de advertências não encontrada. Crie a tabela no Supabase.'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Erro ao salvar advertência no banco de dados: ' + error.message
      });
    }

    console.log('✅ Advertência registrada com sucesso:', data[0].id);

    res.json({
      success: true,
      message: 'Advertência registrada com sucesso!',
      data: data[0]
    });

  } catch (error) {
    console.error('❌ Erro no cadastro de advertência:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor: ' + error.message
    });
  }
});

// Listar todas as advertências
app.get('/api/advertencias', async (req, res) => {
  try {
    const { busca } = req.query;
    
    let query = supabase
      .from('advertencias')
      .select('*')
      .order('data_advertencia', { ascending: false });

    if (busca) {
      query = query.or(`funcionario_nome.ilike.%${busca}%,funcionario_cpf.ilike.%${busca}%,funcionario_matricula.ilike.%${busca}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Erro ao buscar advertências:', error);
      
      // Se a tabela não existir, retornar array vazio
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: [],
          message: 'Tabela de advertências não encontrada'
        });
      }
      
      throw error;
    }

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error('❌ Erro ao listar advertências:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar advertências'
    });
  }
});

// Buscar advertências de um funcionário específico
app.get('/api/advertencias/funcionario/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('advertencias')
      .select('*')
      .eq('funcionario_id', id)
      .order('data_advertencia', { ascending: false });

    if (error) {
      console.error('❌ Erro ao buscar advertências do funcionário:', error);
      
      // Se a tabela não existir, retornar array vazio
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: []
        });
      }
      
      throw error;
    }

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error('❌ Erro ao buscar advertências do funcionário:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar advertências'
    });
  }
});

// Buscar advertência por ID
app.get('/api/advertencias/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('advertencias')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Erro ao buscar advertência:', error);
      
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Advertência não encontrada'
        });
      }
      
      throw error;
    }

    // Buscar informações atualizadas do funcionário
    if (data.funcionario_id) {
      const { data: funcionario } = await supabase
        .from('funcionarios')
        .select('*')
        .eq('id', data.funcionario_id)
        .single();
      
      if (funcionario) {
        data.funcionario_info = funcionario;
      }
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('❌ Erro ao buscar advertência:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar advertência'
    });
  }
});

// Excluir advertência
app.delete('/api/advertencias/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ Excluindo advertência ID: ${id}`);

    const { error } = await supabase
      .from('advertencias')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Erro ao excluir advertência:', error);
      throw error;
    }

    console.log('✅ Advertência excluída com sucesso');

    res.json({
      success: true,
      message: 'Advertência excluída com sucesso!'
    });

  } catch (error) {
    console.error('❌ Erro ao excluir advertência:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao excluir advertência'
    });
  }
});

// ===================================================================
// 🔍 CONSULTA CPF
// ===================================================================

async function consultarAPIExternaCPF(cpf) {
  try {
    const cpfClean = cpf.replace(/\D/g, '');
    
    const url = `https://apicpf.com/api/consulta?cpf=${cpfClean}`;
    const headers = {
      "X-API-KEY": "7616f38484798083668eea3d51d986edeec5c20a93c24a7aea49cc3f0697c929"
    };

    console.log(`🔍 Consultando CPF na API: ${cpfClean}`);
    
    const response = await fetch(url, { 
      headers: headers,
      timeout: 15000 
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('📨 Resposta completa da API CPF:', result);

    if (result && result.code === 200 && result.data && result.data.nome) {
      const data = result.data;
      
      let dataNascimento = data.data_nascimento;
      if (dataNascimento && dataNascimento.includes('-')) {
        const [ano, mes, dia] = dataNascimento.split('-');
        dataNascimento = `${dia}/${mes}/${ano}`;
      }

      let sexo = data.genero;
      if (sexo === 'M') sexo = 'M';
      else if (sexo === 'F') sexo = 'F';

      return {
        nome: data.nome,
        data_nascimento: dataNascimento,
        sexo: sexo
      };
    } else {
      console.log('⚠️ CPF não encontrado na API');
      return null;
    }

  } catch (error) {
    console.error('❌ Erro na API externa de CPF:', error);
    return null;
  }
}

// Rota para consultar CPF
app.post('/api/consultar-cpf', async (req, res) => {
  try {
    const { cpf } = req.body;

    if (!cpf) {
      return res.status(400).json({
        success: false,
        error: 'CPF é obrigatório'
      });
    }

    console.log(`🔍 Consulta CPF solicitada: ${cpf}`);

    const { data: existingFuncionario, error: queryError } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('cpf', cpf.replace(/\D/g, ''))
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('❌ Erro ao consultar CPF no banco:', queryError);
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao consultar CPF'
      });
    }

    if (existingFuncionario) {
      console.log('❌ CPF já cadastrado no sistema:', cpf);
      return res.json({
        success: false,
        error: 'CPF já cadastrado no sistema',
        cpf_existente: true,
        data: null
      });
    }

    const dadosCPF = await consultarAPIExternaCPF(cpf);

    if (dadosCPF) {
      console.log('✅ CPF encontrado na API externa');
      return res.json({
        success: true,
        data: dadosCPF
      });
    } else {
      console.log('⚠️ CPF não encontrado na API externa');
      return res.json({
        success: false,
        error: 'CPF não encontrado na base de dados oficial',
        cpf_existente: false
      });
    }

  } catch (error) {
    console.error('❌ Erro na consulta de CPF:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 🔍 CONSULTA CNPJ
// ===================================================================

async function consultarAPIExternaCNPJ(cnpj) {
  try {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    
    if (cnpjLimpo.length !== 14) {
      throw new Error("CNPJ deve conter 14 dígitos!");
    }
    
    const url = `https://open.cnpja.com/office/${cnpjLimpo}`;
    
    console.log(`🏢 Consultando CNPJ na API: ${cnpjLimpo}`);
    
    const response = await fetch(url, { timeout: 10000 });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('📨 Resposta completa da API CNPJ:', result);

    return result;

  } catch (error) {
    console.error('❌ Erro na API externa de CNPJ:', error);
    throw new Error(`Erro na consulta CNPJ: ${error.message}`);
  }
}

app.post('/api/consultar-cnpj', async (req, res) => {
  try {
    const { cnpj } = req.body;

    if (!cnpj) {
      return res.status(400).json({
        success: false,
        error: 'CNPJ é obrigatório'
      });
    }

    console.log(`🏢 Consulta CNPJ solicitada: ${cnpj}`);

    const { data: existingEmpresa, error: queryError } = await supabase
      .from('empresas')
      .select('*')
      .eq('cnpj', cnpj.replace(/\D/g, ''))
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      console.error('❌ Erro ao consultar CNPJ no banco:', queryError);
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao consultar CNPJ'
      });
    }

    if (existingEmpresa) {
      console.log('❌ CNPJ já cadastrado no sistema:', cnpj);
      return res.json({
        success: false,
        error: 'CNPJ já cadastrado no sistema',
        cnpj_existente: true,
        data: null
      });
    }

    const dadosCNPJ = await consultarAPIExternaCNPJ(cnpj);

    if (dadosCNPJ) {
      console.log('✅ CNPJ encontrado na API externa');
      return res.json({
        success: true,
        data: dadosCNPJ
      });
    } else {
      console.log('⚠️ CNPJ não encontrado na API externa');
      return res.json({
        success: false,
        error: 'CNPJ não encontrado na base de dados oficial',
        cnpj_existente: false
      });
    }

  } catch (error) {
    console.error('❌ Erro na consulta de CNPJ:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 💼 CADASTRO DE EMPRESAS
// ===================================================================

app.post('/api/empresas', async (req, res) => {
  try {
    const empresaData = req.body;

    console.log('🏢 Dados recebidos para cadastro de empresa:', {
      cnpj: empresaData.CNPJ,
      nome_fantasia: empresaData.NOME_FANTASIA
    });

    const camposObrigatorios = ['CNPJ', 'NOME_FANTASIA', 'RAZAO_SOCIAL'];
    const camposFaltantes = camposObrigatorios.filter(campo => !empresaData[campo]);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    const { data: existingEmpresa, error: checkError } = await supabase
      .from('empresas')
      .select('cnpj')
      .eq('cnpj', empresaData.CNPJ)
      .single();

    if (existingEmpresa) {
      console.log('❌ CNPJ já cadastrado no sistema:', empresaData.CNPJ);
      return res.status(400).json({
        success: false,
        error: 'CNPJ já cadastrado no sistema'
      });
    }

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

    const { data, error } = await supabase
      .from('empresas')
      .insert([dadosInserir])
      .select();

    if (error) {
      console.error('❌ Erro ao inserir empresa:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao cadastrar empresa no banco de dados'
      });
    }

    console.log('✅ Empresa cadastrada com sucesso:', data[0].id);

    return res.json({
      success: true,
      message: 'Empresa cadastrada com sucesso!',
      data: data[0]
    });

  } catch (error) {
    console.error('❌ Erro no cadastro de empresa:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ===================================================================
// 📋 LISTAGEM DE EMPRESAS
// ===================================================================

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
    console.error('❌ Erro ao listar empresas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar empresas'
    });
  }
});

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
    console.error('❌ Erro ao buscar empresa:', error);
    res.status(500).json({
      success: false,
      error: 'Empresa não encontrada'
    });
  }
});

// ===================================================================
// 👥 FUNÇÕES PARA LÍDERES
// ===================================================================

async function buscarLideresDisponiveis() {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, nome, matricula')
      .eq('is_lider', true)
      .order('nome');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Erro ao buscar líderes:', error);
    return [];
  }
}

async function validarLiderPorId(liderId) {
  try {
    if (!liderId || liderId.trim() === '') {
      return null;
    }

    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, nome, matricula')
      .eq('id', liderId)
      .eq('is_lider', true)
      .single();

    if (error) {
      console.warn('⚠️ Líder não encontrado por ID:', liderId, error);
      return null;
    }

    console.log('✅ Líder validado:', data);
    return data;
  } catch (error) {
    console.error('❌ Erro ao validar líder por ID:', error);
    return null;
  }
}

// ===================================================================
// 👨‍💼 CADASTRO DE FUNCIONÁRIOS (COM LÍDER POR ID E TAMANHO CALÇADO)
// ===================================================================

app.post('/api/funcionarios', async (req, res) => {
  try {
    const funcionarioData = req.body;
    console.log('📥 Dados recebidos para cadastro de funcionário:', {
      nome: funcionarioData.NOME,
      cpf: funcionarioData.CPF,
      lider_responsavel: funcionarioData.LIDER_RESPONSAVEL,
      tamanho_calcado: funcionarioData.TAMANHO_CALCADO,
      temFoto: !!funcionarioData.FOTO
    });

    const camposObrigatorios = ['NOME', 'CPF', 'EMPRESA', 'SETOR', 'FUNCAO', 'MATRICULA', 'ADMISSAO'];
    const camposFaltantes = camposObrigatorios.filter(campo => !funcionarioData[campo]);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatórios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    const { data: existingFuncionario, error: checkError } = await supabase
      .from('funcionarios')
      .select('cpf')
      .eq('cpf', funcionarioData.CPF.replace(/\D/g, ''))
      .single();

    if (existingFuncionario) {
      console.log('❌ CPF já cadastrado no sistema:', funcionarioData.CPF);
      return res.status(400).json({
        success: false,
        error: 'CPF já cadastrado no sistema'
      });
    }

    let liderId = null;
    let liderNome = null;
    
    if (funcionarioData.LIDER_RESPONSAVEL && funcionarioData.LIDER_RESPONSAVEL.trim() !== '') {
      const liderValido = await validarLiderPorId(funcionarioData.LIDER_RESPONSAVEL);
      
      if (liderValido) {
        liderId = funcionarioData.LIDER_RESPONSAVEL;
        liderNome = liderValido.nome;
        console.log('✅ Líder validado:', liderValido);
      } else {
        console.warn('⚠️ Líder não encontrado ou não é válido:', funcionarioData.LIDER_RESPONSAVEL);
        liderId = null;
        liderNome = null;
      }
    }

    let fotoUrl = null;
    if (funcionarioData.FOTO && funcionarioData.FOTO.startsWith('data:image')) {
      try {
        fotoUrl = await uploadFotoParaStorage(
          funcionarioData.FOTO, 
          funcionarioData.CPF.replace(/\D/g, ''), 
          funcionarioData.MATRICULA
        );
        console.log('✅ Foto uploadada com sucesso:', fotoUrl);
      } catch (uploadError) {
        console.error('❌ Erro no upload da foto:', uploadError);
      }
    }

    let secoesLiderArray = null;
    if (funcionarioData.IS_LIDER && funcionarioData.SECOES_LIDER) {
      if (typeof funcionarioData.SECOES_LIDER === 'string') {
        secoesLiderArray = funcionarioData.SECOES_LIDER
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (Array.isArray(funcionarioData.SECOES_LIDER)) {
        secoesLiderArray = funcionarioData.SECOES_LIDER;
      }
      console.log('📋 Seções do líder processadas:', secoesLiderArray);
    }

    const dadosInserir = {
      nome: funcionarioData.NOME,
      cpf: funcionarioData.CPF.replace(/\D/g, ''),
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
      lider_responsavel: liderId,
      is_lider: funcionarioData.IS_LIDER || false,
      is_pai_mae: funcionarioData.IS_PAI_MAE || false,
      num_filhos: funcionarioData.NUM_FILHOS || 0,
      cep: funcionarioData.END_CEP,
      rua: funcionarioData.END_RUA,
      numero: funcionarioData.END_NUMERO,
      bairro: funcionarioData.END_BAIRRO,
      cidade: funcionarioData.END_CIDADE,
      estado: funcionarioData.END_ESTADO,
      complemento: funcionarioData.END_COMPLEMENTO,
      tamanho_fardamento: funcionarioData.TAMANHO_FARDAMENTO,
      tamanho_calcado: funcionarioData.TAMANHO_CALCADO,
      foto_url: fotoUrl,
      secoes_lider: secoesLiderArray,
      data_criacao: new Date().toISOString()
    };

    for (let i = 1; i <= 5; i++) {
      const campoFilho = `NASC_FILHO_${i}`;
      if (funcionarioData[campoFilho]) {
        dadosInserir[`data_nasc_filho_${i}`] = funcionarioData[campoFilho];
      }
    }

    console.log('📤 Dados para inserção no Supabase:', {
      nome: dadosInserir.nome,
      lider_responsavel: dadosInserir.lider_responsavel,
      empresa: dadosInserir.empresa,
      tamanho_fardamento: dadosInserir.tamanho_fardamento,
      tamanho_calcado: dadosInserir.tamanho_calcado
    });

    const { data, error } = await supabase
      .from('funcionarios')
      .insert([dadosInserir])
      .select();

    if (error) {
      console.error('❌ Erro ao inserir funcionário:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao cadastrar funcionário no banco de dados: ' + error.message
      });
    }

    console.log('✅ Funcionário cadastrado com sucesso:', data[0].id);

    return res.json({
      success: true,
      message: 'Funcionário cadastrado com sucesso!',
      data: data[0],
      foto_url: fotoUrl
    });

  } catch (error) {
    console.error('❌ Erro no cadastro de funcionário:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor: ' + error.message
    });
  }
});

// ===================================================================
// 🔄 ATUALIZAÇÃO DE FUNCIONÁRIOS (COM TAMANHO CALÇADO)
// ===================================================================

app.put('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const funcionarioData = req.body;

    console.log('📥 Atualizando funcionário ID:', id);

    let liderId = null;
    
    if (funcionarioData.LIDER_RESPONSAVEL && funcionarioData.LIDER_RESPONSAVEL.trim() !== '') {
      const liderValido = await validarLiderPorId(funcionarioData.LIDER_RESPONSAVEL);
      
      if (liderValido) {
        liderId = funcionarioData.LIDER_RESPONSAVEL;
        console.log('✅ Líder validado para atualização:', liderValido);
      } else {
        console.warn('⚠️ Líder não encontrado para atualização:', funcionarioData.LIDER_RESPONSAVEL);
        liderId = null;
      }
    }

    let fotoUrl = null;
    if (funcionarioData.FOTO && funcionarioData.FOTO.startsWith('data:image')) {
      try {
        fotoUrl = await uploadFotoParaStorage(
          funcionarioData.FOTO, 
          funcionarioData.CPF ? funcionarioData.CPF.replace(/\D/g, '') : 'sem-cpf', 
          funcionarioData.MATRICULA || 'sem-matricula'
        );
        console.log('✅ Foto atualizada:', fotoUrl);
      } catch (uploadError) {
        console.error('❌ Erro no upload da foto:', uploadError);
      }
    }

    let secoesLiderArray = null;
    if (funcionarioData.IS_LIDER && funcionarioData.SECOES_LIDER) {
      if (typeof funcionarioData.SECOES_LIDER === 'string') {
        secoesLiderArray = funcionarioData.SECOES_LIDER
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (Array.isArray(funcionarioData.SECOES_LIDER)) {
        secoesLiderArray = funcionarioData.SECOES_LIDER;
      }
      console.log('📋 Seções do líder processadas:', secoesLiderArray);
    }

    const dadosAtualizar = {
      nome: funcionarioData.NOME,
      cpf: funcionarioData.CPF ? funcionarioData.CPF.replace(/\D/g, '') : null,
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
      lider_responsavel: liderId,
      is_lider: funcionarioData.IS_LIDER || false,
      is_pai_mae: funcionarioData.IS_PAI_MAE || false,
      num_filhos: funcionarioData.NUM_FILHOS || 0,
      cep: funcionarioData.END_CEP,
      rua: funcionarioData.END_RUA,
      numero: funcionarioData.END_NUMERO,
      bairro: funcionarioData.END_BAIRRO,
      cidade: funcionarioData.END_CIDADE,
      estado: funcionarioData.END_ESTADO,
      complemento: funcionarioData.END_COMPLEMENTO,
      tamanho_fardamento: funcionarioData.TAMANHO_FARDAMENTO,
      tamanho_calcado: funcionarioData.TAMANHO_CALCADO,
      data_atualizacao: new Date().toISOString()
    };

    if (funcionarioData.IS_LIDER) {
      dadosAtualizar.secoes_lider = secoesLiderArray;
    } else {
      dadosAtualizar.secoes_lider = null;
    }

    if (fotoUrl) {
      dadosAtualizar.foto_url = fotoUrl;
    }

    for (let i = 1; i <= 5; i++) {
      const campoFilho = `NASC_FILHO_${i}`;
      if (funcionarioData[campoFilho]) {
        dadosAtualizar[`data_nasc_filho_${i}`] = funcionarioData[campoFilho];
      }
    }

    const { data, error } = await supabase
      .from('funcionarios')
      .update(dadosAtualizar)
      .eq('id', id)
      .select();

    if (error) {
      console.error('❌ Erro ao atualizar funcionário:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar funcionário: ' + error.message
      });
    }

    console.log('✅ Funcionário atualizado com sucesso:', id);

    return res.json({
      success: true,
      message: 'Funcionário atualizado com sucesso!',
      data: data[0],
      foto_url: fotoUrl
    });

  } catch (error) {
    console.error('❌ Erro na atualização de funcionário:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor: ' + error.message
    });
  }
});

// ===================================================================
// 📋 LISTAGEM E CONSULTA DE FUNCIONÁRIOS
// ===================================================================

app.get('/api/funcionarios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('*')
      .order('data_criacao', { ascending: false });

    if (error) {
      throw error;
    }

    const funcionariosComLider = await Promise.all(
      (data || []).map(async (funcionario) => {
        if (funcionario.lider_responsavel) {
          const { data: liderData } = await supabase
            .from('funcionarios')
            .select('nome, matricula, secoes_lider')
            .eq('id', funcionario.lider_responsavel)
            .single();
          
          return {
            ...funcionario,
            lider_info: liderData || null
          };
        }
        return funcionario;
      })
    );

    res.json({
      success: true,
      data: funcionariosComLider
    });

  } catch (error) {
    console.error('❌ Erro ao listar funcionários:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar funcionários'
    });
  }
});

app.get('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: funcionario, error } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    let liderInfo = null;
    if (funcionario.lider_responsavel) {
      const { data: liderData } = await supabase
        .from('funcionarios')
        .select('id, nome, matricula, funcao, setor, secoes_lider')
        .eq('id', funcionario.lider_responsavel)
        .single();
      
      liderInfo = liderData;
    }

    const { data: subordinados } = await supabase
      .from('funcionarios')
      .select('id, nome, matricula, funcao, setor')
      .eq('lider_responsavel', id);

    res.json({
      success: true,
      data: {
        ...funcionario,
        lider_info: liderInfo,
        subordinados: subordinados || []
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar funcionário:', error);
    res.status(500).json({
      success: false,
      error: 'Funcionário não encontrado'
    });
  }
});

// ===================================================================
// 📊 ROTAS PARA LÍDERES
// ===================================================================

app.get('/api/lideres-disponiveis', async (req, res) => {
  try {
    const lideres = await buscarLideresDisponiveis();
    
    console.log(`👥 Líderes disponíveis: ${lideres.length}`);
    
    res.json({
      success: true,
      data: lideres
    });

  } catch (error) {
    console.error('❌ Erro ao listar líderes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar líderes'
    });
  }
});

app.get('/api/lideres-com-secoes', async (req, res) => {
  try {
    const { data: lideres, error } = await supabase
      .from('funcionarios')
      .select('id, nome, matricula, secoes_lider, empresa, setor, funcao')
      .eq('is_lider', true)
      .order('nome');

    if (error) throw error;

    console.log(`👑 Líderes com seções: ${lideres?.length || 0}`);
    
    res.json({
      success: true,
      data: lideres || []
    });

  } catch (error) {
    console.error('❌ Erro ao listar líderes com seções:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar líderes com seções'
    });
  }
});

// ===================================================================
// 🗑️ EXCLUSÃO DE FUNCIONÁRIOS
// ===================================================================

app.delete('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ Excluindo funcionário ID: ${id}`);

    const { error } = await supabase
      .from('funcionarios')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    console.log('✅ Funcionário excluído com sucesso');

    res.json({
      success: true,
      message: 'Funcionário excluído com sucesso!'
    });

  } catch (error) {
    console.error('❌ Erro ao excluir funcionário:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao excluir funcionário'
    });
  }
});

// ===================================================================
// 📁 ROTAS PARA SETORES
// ===================================================================

app.get('/api/setores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('setores')
      .select('*')
      .order('nome');

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('❌ Erro ao listar setores:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar setores'
    });
  }
});

// ===================================================================
// 🛠️ ROTAS PARA FUNÇÕES
// ===================================================================

app.get('/api/funcoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcoes')
      .select('*')
      .order('nome');

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('❌ Erro ao listar funções:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar funções'
    });
  }
});

// ===================================================================
// 🆕 NOVAS FUNÇÕES ADICIONADAS
// ===================================================================

// 1. 🔍 BUSCA AVANÇADA DE FUNCIONÁRIOS
app.get('/api/funcionarios-busca', async (req, res) => {
  try {
    const { nome, cpf, matricula, empresa, setor, funcao } = req.query;
    
    let query = supabase
      .from('funcionarios')
      .select('*');

    if (nome) query = query.ilike('nome', `%${nome}%`);
    if (cpf) query = query.ilike('cpf', `%${cpf}%`);
    if (matricula) query = query.ilike('matricula', `%${matricula}%`);
    if (empresa) query = query.ilike('empresa', `%${empresa}%`);
    if (setor) query = query.ilike('setor', `%${setor}%`);
    if (funcao) query = query.ilike('funcao', `%${funcao}%`);

    query = query.order('nome');

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error('❌ Erro na busca avançada:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na busca avançada'
    });
  }
});

// 2. 📊 ESTATÍSTICAS DO SISTEMA
app.get('/api/estatisticas', async (req, res) => {
  try {
    // Total de funcionários
    const { count: totalFuncionarios } = await supabase
      .from('funcionarios')
      .select('*', { count: 'exact', head: true });

    // Total de empresas
    const { count: totalEmpresas } = await supabase
      .from('empresas')
      .select('*', { count: 'exact', head: true });

    // Total de líderes
    const { count: totalLideres } = await supabase
      .from('funcionarios')
      .select('*', { count: 'exact', head: true })
      .eq('is_lider', true);

    // Funcionários com foto
    const { count: comFoto } = await supabase
      .from('funcionarios')
      .select('*', { count: 'exact', head: true })
      .not('foto_url', 'is', null);

    // Funcionários pais/mães
    const { count: paisMae } = await supabase
      .from('funcionarios')
      .select('*', { count: 'exact', head: true })
      .eq('is_pai_mae', true);

    res.json({
      success: true,
      data: {
        totalFuncionarios: totalFuncionarios || 0,
        totalEmpresas: totalEmpresas || 0,
        totalLideres: totalLideres || 0,
        comFoto: comFoto || 0,
        semFoto: (totalFuncionarios || 0) - (comFoto || 0),
        paisMae: paisMae || 0,
        dataAtualizacao: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar estatísticas'
    });
  }
});

// 3. 📅 ANIVERSARIANTES DO MÊS
app.get('/api/aniversariantes/:mes', async (req, res) => {
  try {
    const mes = parseInt(req.params.mes);
    
    if (mes < 1 || mes > 12) {
      return res.status(400).json({
        success: false,
        error: 'Mês inválido (1-12)'
      });
    }

    // Busca todos os funcionários
    const { data: funcionarios, error } = await supabase
      .from('funcionarios')
      .select('id, nome, data_nascimento, matricula, empresa, foto_url')
      .not('data_nascimento', 'is', null);

    if (error) throw error;

    // Filtra os aniversariantes do mês
    const aniversariantes = funcionarios.filter(func => {
      if (!func.data_nascimento) return false;
      
      try {
        // Formato esperado: DD/MM/AAAA
        const partes = func.data_nascimento.split('/');
        if (partes.length !== 3) return false;
        
        const mesNasc = parseInt(partes[1]);
        return mesNasc === mes;
      } catch {
        return false;
      }
    });

    // Ordena por dia do mês
    aniversariantes.sort((a, b) => {
      const diaA = parseInt(a.data_nascimento.split('/')[0]);
      const diaB = parseInt(b.data_nascimento.split('/')[0]);
      return diaA - diaB;
    });

    res.json({
      success: true,
      mes: mes,
      total: aniversariantes.length,
      data: aniversariantes
    });

  } catch (error) {
    console.error('❌ Erro ao buscar aniversariantes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar aniversariantes'
    });
  }
});

// 4. 👥 FUNCIONÁRIOS POR EMPRESA
app.get('/api/funcionarios-empresa/:empresaId', async (req, res) => {
  try {
    const { empresaId } = req.params;
    
    // Primeiro busca a empresa pelo ID
    const { data: empresa, error: empresaError } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', empresaId)
      .single();

    if (empresaError) {
      return res.status(404).json({
        success: false,
        error: 'Empresa não encontrada'
      });
    }

    // Busca funcionários da empresa
    const { data: funcionarios, error } = await supabase
      .from('funcionarios')
      .select('*')
      .eq('empresa', empresa.nome_fantasia)
      .order('nome');

    if (error) throw error;

    // Agrupa por setor
    const funcionariosPorSetor = {};
    funcionarios.forEach(func => {
      const setor = func.setor || 'Sem setor';
      if (!funcionariosPorSetor[setor]) {
        funcionariosPorSetor[setor] = [];
      }
      funcionariosPorSetor[setor].push(func);
    });

    res.json({
      success: true,
      empresa: empresa,
      totalFuncionarios: funcionarios.length,
      funcionariosPorSetor: funcionariosPorSetor,
      funcionarios: funcionarios
    });

  } catch (error) {
    console.error('❌ Erro ao buscar funcionários por empresa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar funcionários por empresa'
    });
  }
});

// 5. 📈 RELATÓRIO DE ADMISSÕES POR PERÍODO
app.get('/api/relatorio-admissoes', async (req, res) => {
  try {
    const { dataInicio, dataFim } = req.query;
    
    let query = supabase
      .from('funcionarios')
      .select('*')
      .not('data_admissao', 'is', null);

    if (dataInicio) {
      query = query.gte('data_admissao', dataInicio);
    }
    if (dataFim) {
      query = query.lte('data_admissao', dataFim);
    }

    query = query.order('data_admissao', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    // Agrupa por mês/ano
    const admissoesPorMes = {};
    data.forEach(func => {
      if (func.data_admissao) {
        const dataAdm = new Date(func.data_admissao);
        const mesAno = `${dataAdm.getMonth() + 1}/${dataAdm.getFullYear()}`;
        
        if (!admissoesPorMes[mesAno]) {
          admissoesPorMes[mesAno] = [];
        }
        admissoesPorMes[mesAno].push(func);
      }
    });

    res.json({
      success: true,
      periodo: {
        dataInicio,
        dataFim
      },
      totalAdmissoes: data.length,
      admissoesPorMes: admissoesPorMes,
      detalhes: data
    });

  } catch (error) {
    console.error('❌ Erro ao gerar relatório de admissões:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório'
    });
  }
});

// 6. 👕 RELATÓRIO DE TAMANHOS DE FARDAMENTO
app.get('/api/relatorio-fardamento', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('tamanho_fardamento')
      .not('tamanho_fardamento', 'is', null);

    if (error) throw error;

    // Conta frequência de tamanhos
    const frequencia = {};
    data.forEach(func => {
      const tamanho = func.tamanho_fardamento;
      frequencia[tamanho] = (frequencia[tamanho] || 0) + 1;
    });

    // Ordena por frequência
    const frequenciaOrdenada = Object.entries(frequencia)
      .sort((a, b) => b[1] - a[1])
      .map(([tamanho, quantidade]) => ({ tamanho, quantidade }));

    res.json({
      success: true,
      totalRegistros: data.length,
      frequencia: frequenciaOrdenada
    });

  } catch (error) {
    console.error('❌ Erro ao gerar relatório de fardamento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório'
    });
  }
});

// 7. 👟 RELATÓRIO DE TAMANHOS DE CALÇADO
app.get('/api/relatorio-calcado', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('tamanho_calcado')
      .not('tamanho_calcado', 'is', null);

    if (error) throw error;

    // Conta frequência de tamanhos
    const frequencia = {};
    data.forEach(func => {
      const tamanho = func.tamanho_calcado;
      if (tamanho) {
        frequencia[tamanho] = (frequencia[tamanho] || 0) + 1;
      }
    });

    // Ordena por tamanho numérico
    const frequenciaOrdenada = Object.entries(frequencia)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([tamanho, quantidade]) => ({ tamanho, quantidade }));

    res.json({
      success: true,
      totalRegistros: data.length,
      frequencia: frequenciaOrdenada
    });

  } catch (error) {
    console.error('❌ Erro ao gerar relatório de calçado:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório'
    });
  }
});

// 8. 🔄 SINCRONIZAÇÃO DE LÍDERES
app.post('/api/sincronizar-lideres', async (req, res) => {
  try {
    console.log('🔄 Iniciando sincronização de líderes...');

    // Busca todos os funcionários que são líderes
    const { data: lideres, error: errorLideres } = await supabase
      .from('funcionarios')
      .select('id, nome, matricula, secoes_lider')
      .eq('is_lider', true);

    if (errorLideres) throw errorLideres;

    // Atualiza subordinados com informações do líder
    let atualizacoes = 0;
    
    for (const lider of lideres) {
      // Atualiza funcionários que têm este líder
      const { error: updateError } = await supabase
        .from('funcionarios')
        .update({
          lider_info: {
            nome: lider.nome,
            matricula: lider.matricula,
            secoes: lider.secoes_lider
          }
        })
        .eq('lider_responsavel', lider.id);

      if (!updateError) {
        atualizacoes++;
      }
    }

    console.log(`✅ Sincronização concluída: ${atualizacoes} líderes processados`);

    res.json({
      success: true,
      message: `Sincronização concluída com sucesso! ${atualizacoes} líderes processados.`,
      totalLideres: lideres.length,
      atualizacoes: atualizacoes
    });

  } catch (error) {
    console.error('❌ Erro na sincronização de líderes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na sincronização de líderes'
    });
  }
});

// 9. 📍 BUSCA POR CEP (VIA API externa)
app.get('/api/consulta-cep/:cep', async (req, res) => {
  try {
    const { cep } = req.params;
    const cepLimpo = cep.replace(/\D/g, '');

    if (cepLimpo.length !== 8) {
      return res.status(400).json({
        success: false,
        error: 'CEP inválido. Deve conter 8 dígitos.'
      });
    }

    console.log(`📍 Consultando CEP: ${cepLimpo}`);

    const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      timeout: 5000
    });

    if (!response.ok) {
      throw new Error(`Erro na API de CEP: ${response.status}`);
    }

    const dadosCep = await response.json();

    if (dadosCep.erro) {
      return res.json({
        success: false,
        error: 'CEP não encontrado'
      });
    }

    res.json({
      success: true,
      data: {
        cep: dadosCep.cep,
        logradouro: dadosCep.logradouro,
        complemento: dadosCep.complemento,
        bairro: dadosCep.bairro,
        cidade: dadosCep.localidade,
        estado: dadosCep.uf
      }
    });

  } catch (error) {
    console.error('❌ Erro na consulta de CEP:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na consulta de CEP'
    });
  }
});

// 10. 📋 EXPORTAÇÃO DE DADOS (CSV)
app.get('/api/exportar-funcionarios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('*')
      .order('nome');

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({
        success: false,
        error: 'Nenhum funcionário para exportar'
      });
    }

    // Cabeçalhos do CSV
    const cabecalhos = [
      'ID', 'Nome', 'CPF', 'Matrícula', 'Empresa', 'Setor', 'Função',
      'Data Admissão', 'Salário', 'Líder', 'Tamanho Fardamento',
      'Tamanho Calçado', 'Data Nascimento', 'Sexo', 'RG', 'PIS'
    ];

    // Converte dados para CSV
    const linhasCSV = data.map(func => [
      func.id,
      `"${func.nome || ''}"`,
      func.cpf || '',
      func.matricula || '',
      `"${func.empresa || ''}"`,
      `"${func.setor || ''}"`,
      `"${func.funcao || ''}"`,
      func.data_admissao || '',
      func.salario || '',
      `"${func.lider_info?.nome || ''}"`,
      func.tamanho_fardamento || '',
      func.tamanho_calcado || '',
      func.data_nascimento || '',
      func.sexo || '',
      func.rg || '',
      func.pis || ''
    ].join(','));

    const csvContent = [
      cabecalhos.join(','),
      ...linhasCSV
    ].join('\n');

    // Configura headers para download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=funcionarios.csv');
    
    res.send(csvContent);

  } catch (error) {
    console.error('❌ Erro na exportação de dados:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na exportação de dados'
    });
  }
});

// ===================================================================
// 🚀 INICIALIZAÇÃO DO SERVIDOR
// ===================================================================

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`🚀 Servidor do Sistema RH rodando na porta ${PORT}`);
  console.log('='.repeat(60));
  console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
  console.log(`🔐 API CPF: Integrada com apicpf.com`);
  console.log(`🏢 API CNPJ: Integrada com open.cnpja.com`);
  console.log(`🖼️  Storage de fotos: fotos-funcionarios`);
  console.log(`⚠️  Storage de advertências: arquivos-advertencias`);
  console.log(`👥 Sistema de líderes: Ativo com validação por ID`);
  console.log(`👕 Tamanho de fardamento: Suportado`);
  console.log(`👟 Tamanho de calçado: Adicionado (33-47)`);
  console.log(`📁 Upload de fotos: Ativo (máx 2MB)`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
  console.log('');
  console.log('🎯 ROTAS DE ADVERTÊNCIAS:');
  console.log(`⚠️  Criar advertência: POST /api/advertencias`);
  console.log(`📋 Listar advertências: GET /api/advertencias`);
  console.log(`👤 Por funcionário: GET /api/advertencias/funcionario/:id`);
  console.log(`🔍 Detalhes: GET /api/advertencias/:id`);
  console.log(`🗑️  Excluir: DELETE /api/advertencias/:id`);
  console.log('');
  console.log('🆕 NOVAS FUNCIONALIDADES:');
  console.log(`🔍  Busca Avançada: /api/funcionarios-busca`);
  console.log(`📊  Estatísticas: /api/estatisticas`);
  console.log(`📅  Aniversariantes: /api/aniversariantes/:mes`);
  console.log(`👥  Por Empresa: /api/funcionarios-empresa/:id`);
  console.log(`📈  Relatório Admissões: /api/relatorio-admissoes`);
  console.log(`👕  Relatório Fardamento: /api/relatorio-fardamento`);
  console.log(`👟  Relatório Calçado: /api/relatorio-calcado`);
  console.log(`🔄  Sincronizar Líderes: /api/sincronizar-lideres`);
  console.log(`📍  Consulta CEP: /api/consulta-cep/:cep`);
  console.log(`📋  Exportar Dados: /api/exportar-funcionarios`);
  console.log('='.repeat(60));
  console.log('✅ Backend pronto para receber requisições!');
  console.log('='.repeat(60));
});

module.exports = app;
