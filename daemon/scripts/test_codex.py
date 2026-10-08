#!/usr/bin/env python3
"""Codex transport and structured approval regressions; no model calls."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from remote_ai_chat.providers.base import ProviderConfig
from remote_ai_chat.providers.codex import CodexProvider
from remote_ai_chat.structured_approval import validate_response
from remote_ai_chat.errors import Err


class CodexTests(unittest.IsolatedAsyncioTestCase):
    def provider(self, session='existing'):
        async def emit(*args): pass
        async def approval(*args): return 'deny'
        return CodexProvider(ProviderConfig(model='test', effort=None, perm_mode='auto-edit',
            cwd=tempfile.gettempdir(), session_id=session, preamble='Divan context',
            agent_prompt='Hermes instructions'), emit, approval)

    async def test_large_resume_and_instructions(self):
        with tempfile.TemporaryDirectory() as d:
            cli = Path(d) / 'fake-codex'
            cli.write_text('#!' + sys.executable + '\n' + '''import json, sys
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 if m['method']=='initialize': r={}
 else:
  assert m['method']=='thread/resume'
  assert m['params']['developerInstructions']=='Divan context\\n\\nHermes instructions'
  r={'thread': {'id': m['params']['threadId'], 'history': 'x'*250000}}
 print(json.dumps({'id':m['id'],'result':r}), flush=True)
''')
            cli.chmod(0o700)
            p = self.provider()
            with patch('remote_ai_chat.providers.codex.tools.find_cli', return_value=str(cli)):
                try:
                    await asyncio.wait_for(p._ensure(), 5)
                    self.assertEqual(p._thread_id, 'existing')
                    self.assertFalse(p._reader.done())
                finally:
                    await p.close()

    async def test_failed_resume_does_not_start_empty_thread(self):
        p = self.provider()
        calls = []
        async def rpc(method, params, **kwargs):
            calls.append(method)
            if method == 'thread/resume': raise RuntimeError('missing thread')
            return {}
        async def send(*args): pass
        p._call = rpc
        p._send = send
        with patch('remote_ai_chat.providers.codex.tools.find_cli', return_value='/usr/bin/false'):
            try:
                with self.assertRaisesRegex(RuntimeError, 'history was preserved'):
                    await p._ensure()
                self.assertNotIn('thread/start', calls)
            finally: await p.close()

    async def test_elicitation_reaches_client_and_returns_content(self):
        p = self.provider()
        sent = []
        async def send(msg): sent.append(msg)
        async def approval(tool, request, reason):
            self.assertEqual(request['kind'], 'mcp_elicitation')
            return {'decision': 'allow', 'response': {'content': {'confirmed': True}}}
        p._send, p.approval = send, approval
        await p._server_request(7, 'mcpServer/elicitation/request', {
            'mode':'form', 'message':'Confirm', 'requestedSchema': {
                'type':'object','properties':{'confirmed':{'type':'boolean'}},'required':['confirmed']}})
        self.assertEqual(sent, [{'id':7,'result':{'action':'accept','content':{'confirmed':True}}}])

    async def test_question_answer_and_decline(self):
        p = self.provider()
        sent=[]
        async def send(msg): sent.append(msg)
        async def approval(*args):
            return {'decision':'allow','response':{'answers':{'q':{'answers':['Other answer']}}}}
        p._send,p.approval=send,approval
        params={'questions':[{'id':'q','question':'Which?', 'isOther':True,'options':[{'label':'One'}]}]}
        await p._server_request(8,'item/tool/requestUserInput',params)
        self.assertEqual(sent[-1]['result']['answers']['q']['answers'],['Other answer'])
        async def deny(*args): return 'deny'
        p.approval=deny
        await p._server_request(9,'item/tool/requestUserInput',params)
        self.assertIn('error',sent[-1])

    async def test_session_validates_before_resolving_without_saving_answers(self):
        from remote_ai_chat.session import ChatSession
        s = ChatSession.__new__(ChatSession)
        request = {'kind':'mcp_elicitation','mode':'form','requestedSchema':{
            'type':'object','properties':{'confirmed':{'type':'boolean'}},'required':['confirmed']}}
        future = asyncio.get_running_loop().create_future()
        s.pending = {'request':future}
        s._approval_inputs = {'request':request}
        with self.assertRaises(Err):
            s.respond('request','allow',{'content':{'confirmed':'wrong type'}})
        self.assertFalse(future.done())
        self.assertTrue(s.respond('request','allow',{'content':{'confirmed':True}}))
        self.assertEqual((await future)['response']['content'],{'confirmed':True})
        self.assertFalse(s.respond('request','deny'))

    def test_write_only_field_is_supported(self):
        request = {'kind':'mcp_elicitation','mode':'form','requestedSchema':{
            'type':'object','properties':{'password':{'type':'string','writeOnly':True}},'required':['password']}}
        value = validate_response(request,'allow',{'content':{'password':'test-secret'}})
        self.assertEqual(value['response']['content'],{'password':'test-secret'})

    def test_invalid_form_response_does_not_leak_value(self):
        request={'kind':'mcp_elicitation','mode':'form','requestedSchema':{
            'type':'object','properties':{'count':{'type':'integer'}},'required':['count']}}
        with self.assertRaises(Err) as result:
            validate_response(request,'allow',{'content':{'count':'secret-value'}})
        self.assertNotIn('secret-value',str(result.exception))


if __name__ == '__main__': unittest.main()
