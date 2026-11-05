import httpx
from fastapi.testclient import TestClient
from app.main import create_app
from app import research
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
import io
import json


def pdf_fixture(encrypted=False):
    writer=PdfWriter()
    for text in ['Launch date Friday.', 'Budget zero dollars.']:
        page=writer.add_blank_page(400,400)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        content=DecodedStreamObject();content.set_data(f'BT /F1 12 Tf 20 200 Td ({text}) Tj ET'.encode())
        page[NameObject('/Contents')]=writer._add_object(content)
    if encrypted:writer.encrypt('secret')
    output=io.BytesIO();writer.write(output);return output.getvalue()


def test_document_evidence_is_literal_local_and_line_cited():
    with TestClient(create_app(token='test')) as client:
        body={'name':'plan.md','text':'# Plan\nRelease date: Friday.\nBudget: zero.','question':'What is the budget?'}
        assert client.post('/api/v1/research/document',json=body).status_code==401
        response=client.post('/api/v1/research/document',json=body,headers={'Authorization':'Bearer test'})
        assert response.status_code==200
        assert response.json()['passages']==[{'line':3,'column':1,'text':'Budget: zero.'}]
        body['question']='Who discovered Neptune?'
        assert client.post('/api/v1/research/document',json=body,headers={'Authorization':'Bearer test'}).json()['found'] is False


def test_document_limits_formats_and_preview():
    with TestClient(create_app(token='test'),headers={'Authorization':'Bearer test'}) as client:
        base={'name':'x.txt','text':'First line\nSecond line','mode':'summary'}
        assert len(client.post('/api/v1/research/document',json=base).json()['passages'])==2
        for changes in [{'name':'x.pdf'},{'text':' '},{'text':'\x00binary'},{'text':'x'*20001},{'mode':'execute'}]:
            assert client.post('/api/v1/research/document',json={**base,**changes}).status_code==422


def test_search_uses_fixed_provider_and_strips_html(monkeypatch):
    async def get(self,url,**kwargs):
        assert url=='https://en.wikipedia.org/w/api.php'
        assert kwargs['params']['srlimit']==5
        return httpx.Response(200,json={'query':{'search':[{'title':'Earth','pageid':42,'snippet':'A <b>planet</b> &amp; home.'}]}},request=httpx.Request('GET',url))
    monkeypatch.setattr(httpx.AsyncClient,'get',get)
    with TestClient(create_app(token='test'),headers={'Authorization':'Bearer test'}) as client:
        data=client.post('/api/v1/research/search',json={'query':'Earth'}).json()
        assert data['results']==[{'title':'Earth','url':'https://en.wikipedia.org/?curid=42','snippet':'A planet & home.'}]


def test_search_failure_and_empty_query_do_not_invent_results(monkeypatch):
    async def get(*args,**kwargs):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(httpx.AsyncClient,'get',get)
    with TestClient(create_app(token='test'),headers={'Authorization':'Bearer test'}) as client:
        assert client.post('/api/v1/research/search',json={'query':'Earth'}).status_code==502
        assert client.post('/api/v1/research/search',json={'query':' '}).status_code==422


def test_real_pdf_extraction_and_page_citations():
    with TestClient(create_app(token='test')) as client:
        data=pdf_fixture()
        assert client.post('/api/v1/research/pdf',content=data,headers={'Content-Type':'application/pdf'}).status_code==401
        headers={'Authorization':'Bearer test','Content-Type':'application/pdf'}
        result=client.post('/api/v1/research/pdf',content=data,headers=headers)
        assert result.status_code==200 and result.json()['page_count']==2
        pages=[page['text'] for page in result.json()['pages']]
        answer=client.post('/api/v1/research/document',json={'name':'plan.pdf','text':'PDF document','pages':pages,'question':'What is the budget?'},headers={'Authorization':'Bearer test'}).json()
        assert answer['passages'][0]['page']==2
        assert 'Budget zero dollars.' in answer['passages'][0]['text']
        assert client.post('/api/v1/research/pdf',content=pdf_fixture(True),headers=headers).status_code==422
        assert client.post('/api/v1/research/pdf',content=b'not a PDF',headers=headers).status_code==422


def test_local_answer_validates_quotes_and_refuses_cloud_fallback():
    class Local:
        model='test-local'
        def __init__(self):self.calls=0;self.bad=False
        async def answer(self,prompt,history):
            self.calls+=1
            return json.dumps({'claims':[{'text':'The budget is zero.', 'source':1,'quote':'fabricated quotation' if self.bad else 'Budget: zero.'}]})
    local=Local();body={'name':'plan.txt','text':'Budget: zero.','question':'What is the budget?'}
    with TestClient(create_app(token='test',ollama=local),headers={'Authorization':'Bearer test'}) as client:
        response=client.post('/api/v1/research/answer',json=body)
        assert response.status_code==200 and response.json()['claims'][0]['source']==1
        local.bad=True
        assert client.post('/api/v1/research/answer',json=body).status_code==502
        body['question']='Who discovered Neptune?'
        assert client.post('/api/v1/research/answer',json=body).json()['claims']==[]
        assert local.calls==2
    body['question']='What is the budget?'
    with TestClient(create_app(token='test'),headers={'Authorization':'Bearer test'}) as client:
        assert client.post('/api/v1/research/answer',json=body).status_code==503


def test_searxng_configuration_and_safe_result_urls(monkeypatch):
    monkeypatch.delenv('ORACLE_SEARXNG_URL',raising=False)
    with TestClient(create_app(token='test'),headers={'Authorization':'Bearer test'}) as client:
        assert client.post('/api/v1/research/search',json={'query':'Earth','provider':'searxng'}).status_code==503
        monkeypatch.setenv('ORACLE_SEARXNG_URL','http://127.0.0.1:8888')
        async def get(self,url,**kwargs):
            assert url=='http://127.0.0.1:8888/search'
            return httpx.Response(200,json={'results':[{'title':'Unsafe','url':'javascript:bad'},{'title':'Reference','url':'https://example.org/','content':'A <b>source</b>'}]},request=httpx.Request('GET',url))
        monkeypatch.setattr(httpx.AsyncClient,'get',get)
        result=client.post('/api/v1/research/search',json={'query':'Earth','provider':'searxng'}).json()
        assert result['results']==[{'title':'Reference','url':'https://example.org/','snippet':'A source'}]
        monkeypatch.setenv('ORACLE_SEARXNG_URL','http://foreign.example')
        assert client.post('/api/v1/research/search',json={'query':'Earth','provider':'searxng'}).status_code==503


def test_document_structured_output_and_remote_provider_rejection(monkeypatch):
    from app.ollama import Ollama
    import json
    async def post(self,url,**kwargs):
        payload=kwargs['json']
        assert payload['format']['required']==['claims']
        assert payload['options']['temperature']==0
        return httpx.Response(200,json={'message':{'content':json.dumps({'claims':[{'text':'Zero budget.', 'source':1,'quote':'Budget: zero.'}]})}},request=httpx.Request('POST',url))
    monkeypatch.setattr(httpx.AsyncClient,'post',post)
    body={'name':'plan.txt','text':'Budget: zero.','question':'What is the budget?'}
    with TestClient(create_app(token='test',ollama=Ollama()),headers={'Authorization':'Bearer test'}) as client:
        assert client.post('/api/v1/research/answer',json=body).status_code==200
    with TestClient(create_app(token='test',ollama=Ollama(base_url='https://remote.example')),headers={'Authorization':'Bearer test'}) as client:
        assert client.post('/api/v1/research/answer',json=body).status_code==503
