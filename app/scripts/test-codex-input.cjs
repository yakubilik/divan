const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require('sucrase');
function load(file) {
  const module = { exports: {} };
  new Function('module', 'exports', transform(fs.readFileSync(path.join(__dirname,'..',file), 'utf8'), { transforms: ['typescript', 'imports'] }).code)(module, module.exports);
  return module.exports;
}
const { permissionFor } = load('src/permissions.ts');
const { approvalFields, approvalResponse, approvalUrl } = load('src/approval-input.ts');
// The computer's declared default wins over any remembered word: one `ask`
// picked once must not become every chat after it.
const cat = { perm_modes: ['suggest', 'auto-edit', 'bypass'], default_perm_mode: 'bypass' };
assert.equal(permissionFor('codex', cat, {provider:'claude',perm_mode:'auto-edit'}), 'bypass');
assert.equal(permissionFor('codex', cat, {provider:'codex',perm_mode:'suggest', byProvider:{codex:{perm_mode:'suggest'}}}), 'bypass');
// A daemon that declares none is the only one a remembered word decides for.
const old = { perm_modes: ['suggest', 'auto-edit', 'bypass'] };
assert.equal(permissionFor('codex', old, {provider:'codex',perm_mode:'suggest'}), 'suggest');
assert.equal(permissionFor('codex', old, {provider:'claude',perm_mode:'ask'}), 'bypass');
const input = {kind:'mcp_elicitation',mode:'form',requestedSchema:{type:'object',properties:{count:{type:'integer'},accepted:{type:'boolean'}},required:['count','accepted']}};
const fields = approvalFields(input);
assert.deepEqual(approvalResponse(input,fields,{count:'2',accepted:false}),{content:{count:2,accepted:false}});
assert.equal(approvalResponse(input,fields,{count:'2.5',accepted:true}),null);
const q = {kind:'user_input',questions:[{id:'q',question:'Which?',options:[{label:'One'}],isOther:false}]};
assert.equal(approvalFields(q)[0].allowOther,false);
assert.deepEqual(approvalResponse(q,approvalFields(q),{q:'One'}),{answers:{q:{answers:['One']}}});
assert.equal(approvalUrl('javascript:alert(1)'),null);
assert.equal(approvalUrl('https://user:secret@example.com'),null);
console.log('Codex mobile permission and form checks passed');
