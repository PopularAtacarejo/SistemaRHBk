from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
import time
from datetime import datetime
from supabase import create_client, Client
import logging
import re

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configurações do Supabase
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://tmgglppfobyoosfiewoa.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZ2dscHBmb2J5b29zZmlld29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3Mjg4NTEsImV4cCI6MjA3OTMwNDg1MX0.DH3IyjnE7zztySzyckKREy5Zlgmg2aJe4TEXIbmFmkA')

# Inicializar Supabase
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("Supabase conectado com sucesso!")
except Exception as e:
    logger.error(f"Erro ao conectar com Supabase: {e}")
    supabase = None

# Variável para controlar se o servidor está "acordado"
last_request_time = time.time()

# ===================================================================
# 🔍 FUNÇÕES DE CONSULTA CPF (Integradas do api_services.py)
# ===================================================================

def search_cpf(cpf):
    """
    Busca dados de pessoa física por CPF.
    API Key fornecida pelo usuário.
    """
    # Limpa formatação para envio
    cpf_clean = ''.join(filter(str.isdigit, cpf))
    
    url = f"https://apicpf.com/api/consulta?cpf={cpf_clean}"
    headers = {
        "X-API-KEY": "7616f38484798083668eea3d51d986edeec5c20a93c24a7aea49cc3f0697c929"
    }
    
    try:
        logger.info(f"Consultando CPF: {cpf_clean}")
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
        logger.info(f"Resposta API CPF: {data}")
        return data
    except requests.RequestException as e:
        logger.error(f"Erro na API CPF: {e}")
        return None

def search_cep(cep):
    """
    Busca um CEP na API ViaCEP.
    """
    cep_clean = ''.join(filter(str.isdigit, cep))
    
    if len(cep_clean) != 8:
        return None
    
    url = f"https://viacep.com.br/ws/{cep_clean}/json/"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data.get("erro"):
            return None
        return data
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro na requisição do CEP: {e}")
        return None

def formatar_data_iso(data_str):
    """Converte data DD/MM/AAAA para ISO"""
    try:
        if data_str and '/' in data_str:
            day, month, year = data_str.split('/')
            return f"{year}-{month}-{day}"
        return data_str
    except:
        return data_str

def formatar_data_br(data_iso):
    """Converte data ISO para DD/MM/AAAA"""
    try:
        if data_iso and '-' in data_iso:
            year, month, day = data_iso.split('-')
            return f"{day}/{month}/{year}"
        return data_iso
    except:
        return data_iso

# ===================================================================
# 🚀 ENDPOINTS DA API
# ===================================================================

@app.route('/')
def home():
    return jsonify({
        "status": "API RH está funcionando!", 
        "timestamp": datetime.now().isoformat(),
        "supabase_connected": supabase is not None
    })

@app.route('/api/funcionarios', methods=['GET', 'POST'])
def funcionarios():
    global last_request_time
    last_request_time = time.time()
    
    try:
        if request.method == 'GET':
            # Buscar todos os funcionários
            response = supabase.table('funcionarios').select('*').order('id', desc=True).execute()
            return jsonify({
                "success": True,
                "data": response.data
            })
        
        elif request.method == 'POST':
            # Criar novo funcionário
            data = request.get_json()
            logger.info(f"Dados recebidos para salvar: {data}")
            
            # Validar campos obrigatórios
            campos_obrigatorios = ['NOME', 'CPF', 'EMPRESA', 'SETOR', 'FUNÇÃO', 'MAT', 'ADMISSÃO']
            campos_faltantes = [campo for campo in campos_obrigatorios if not data.get(campo)]
            
            if campos_faltantes:
                return jsonify({
                    "success": False,
                    "error": f"Campos obrigatórios faltando: {', '.join(campos_faltantes)}"
                }), 400
            
            # Formatar datas para ISO
            if data.get('NASC'):
                data['NASC'] = formatar_data_iso(data['NASC'])
            if data.get('ADMISSÃO'):
                data['ADMISSÃO'] = formatar_data_iso(data['ADMISSÃO'])
            
            # Formatar dados dos filhos
            for i in range(1, 6):
                campo_filho = f'NASC_FILHO_{i}'
                if data.get(campo_filho):
                    data[campo_filho] = formatar_data_iso(data[campo_filho])
            
            # Inserir no Supabase
            response = supabase.table('funcionarios').insert(data).execute()
            
            if response.data:
                logger.info(f"Funcionário criado com ID: {response.data[0]['id']}")
                return jsonify({
                    "success": True,
                    "message": "Funcionário criado com sucesso",
                    "data": response.data[0]
                })
            else:
                logger.error(f"Erro ao criar funcionário: {response}")
                return jsonify({
                    "success": False,
                    "error": "Erro ao criar funcionário no banco de dados"
                }), 500
                
    except Exception as e:
        logger.error(f"Erro em /api/funcionarios: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Erro interno do servidor: {str(e)}"
        }), 500

@app.route('/api/funcionarios/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def funcionario(id):
    global last_request_time
    last_request_time = time.time()
    
    try:
        if request.method == 'GET':
            response = supabase.table('funcionarios').select('*').eq('id', id).execute()
            if response.data:
                # Converter datas para formato BR
                funcionario = response.data[0]
                if funcionario.get('NASC'):
                    funcionario['NASC'] = formatar_data_br(funcionario['NASC'])
                if funcionario.get('ADMISSÃO'):
                    funcionario['ADMISSÃO'] = formatar_data_br(funcionario['ADMISSÃO'])
                
                return jsonify({
                    "success": True,
                    "data": funcionario
                })
            return jsonify({
                "success": False,
                "error": "Funcionário não encontrado"
            }), 404
        
        elif request.method == 'PUT':
            data = request.get_json()
            
            # Formatar datas para ISO
            if data.get('NASC'):
                data['NASC'] = formatar_data_iso(data['NASC'])
            if data.get('ADMISSÃO'):
                data['ADMISSÃO'] = formatar_data_iso(data['ADMISSÃO'])
            
            response = supabase.table('funcionarios').update(data).eq('id', id).execute()
            
            if response.data:
                return jsonify({
                    "success": True,
                    "message": "Funcionário atualizado",
                    "data": response.data[0]
                })
            return jsonify({
                "success": False,
                "error": "Erro ao atualizar funcionário"
            }), 500
        
        elif request.method == 'DELETE':
            response = supabase.table('funcionarios').delete().eq('id', id).execute()
            return jsonify({
                "success": True,
                "message": "Funcionário excluído com sucesso"
            })
            
    except Exception as e:
        logger.error(f"Erro em /api/funcionarios/{id}: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Erro interno do servidor: {str(e)}"
        }), 500

@app.route('/api/consultar-cpf', methods=['POST'])
def consultar_cpf():
    global last_request_time
    last_request_time = time.time()
    
    try:
        data = request.get_json()
        cpf = data.get('cpf', '').replace('.', '').replace('-', '')
        
        if len(cpf) != 11:
            return jsonify({
                "success": False,
                "error": "CPF deve conter 11 dígitos"
            }), 400
        
        # Verificar se CPF já existe no banco
        response = supabase.table('funcionarios').select('id, NOME').eq('CPF', cpf).execute()
        
        if response.data:
            return jsonify({
                "success": False,
                "error": f"CPF já cadastrado para: {response.data[0]['NOME']}",
                "cpf_existente": True
            }), 400
        
        # Consultar API de CPF
        logger.info(f"Iniciando consulta CPF para: {cpf}")
        resultado = search_cpf(cpf)
        
        if not resultado:
            return jsonify({
                "success": False,
                "error": "CPF não encontrado ou serviço temporariamente indisponível"
            }), 404
        
        # Processar resposta da API CPF
        logger.info(f"Resultado bruto da API CPF: {resultado}")
        
        # Mapear campos da resposta da API para nosso formato
        # A API retorna: nome, data_nascimento, sexo
        dados_pessoa = {
            "nome": resultado.get('nome', ''),
            "data_nascimento": resultado.get('data_nascimento', ''),
            "sexo": resultado.get('sexo', '')
        }
        
        # Validar se temos dados suficientes
        if not dados_pessoa['nome']:
            return jsonify({
                "success": False,
                "error": "Dados não encontrados para este CPF"
            }), 404
        
        # Converter sexo para formato do nosso sistema (M/F)
        sexo_map = {
            'MASCULINO': 'M',
            'FEMININO': 'F',
            'M': 'M',
            'F': 'F'
        }
        
        dados_pessoa['sexo'] = sexo_map.get(dados_pessoa['sexo'].upper(), '')
        
        logger.info(f"Dados processados da consulta CPF: {dados_pessoa}")
        
        return jsonify({
            "success": True,
            "message": "Consulta realizada com sucesso",
            "data": dados_pessoa,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Erro em /api/consultar-cpf: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Erro na consulta: {str(e)}"
        }), 500

@app.route('/api/consultar-cep', methods=['POST'])
def consultar_cep():
    global last_request_time
    last_request_time = time.time()
    
    try:
        data = request.get_json()
        cep = data.get('cep', '').replace('-', '').replace('.', '')
        
        if len(cep) != 8:
            return jsonify({
                "success": False,
                "error": "CEP deve conter 8 dígitos"
            }), 400
        
        # Consultar API ViaCEP
        resultado = search_cep(cep)
        
        if not resultado:
            return jsonify({
                "success": False,
                "error": "CEP não encontrado"
            }), 404
        
        # Mapear resposta do ViaCEP
        endereco = {
            "logradouro": resultado.get('logradouro', ''),
            "bairro": resultado.get('bairro', ''),
            "cidade": resultado.get('localidade', ''),
            "estado": resultado.get('uf', ''),
            "cep": resultado.get('cep', '')
        }
        
        return jsonify({
            "success": True,
            "message": "CEP encontrado",
            "data": endereco
        })
        
    except Exception as e:
        logger.error(f"Erro em /api/consultar-cep: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Erro na consulta CEP: {str(e)}"
        }), 500

@app.route('/api/empresas', methods=['GET'])
def empresas():
    global last_request_time
    last_request_time = time.time()
    
    try:
        response = supabase.table('empresas').select('*').execute()
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        logger.error(f"Erro em /api/empresas: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/setores', methods=['GET'])
def setores():
    global last_request_time
    last_request_time = time.time()
    
    try:
        response = supabase.table('setores').select('*').execute()
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        logger.error(f"Erro em /api/setores: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/funcoes', methods=['GET'])
def funcoes():
    global last_request_time
    last_request_time = time.time()
    
    try:
        response = supabase.table('funcoes').select('*').execute()
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        logger.error(f"Erro em /api/funcoes: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "online", 
        "last_request": datetime.fromtimestamp(last_request_time).isoformat(),
        "uptime": time.time() - last_request_time,
        "supabase_connected": supabase is not None,
        "timestamp": datetime.now().isoformat()
    })

# Endpoint para manter o servidor acordado
@app.route('/api/wakeup', methods=['GET'])
def wakeup():
    global last_request_time
    last_request_time = time.time()
    return jsonify({
        "status": "awake",
        "message": "Servidor está acordado e pronto",
        "timestamp": datetime.now().isoformat()
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
