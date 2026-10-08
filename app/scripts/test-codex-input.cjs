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
const cat = { perm_modes: ['suggest', 'auto-edit', 'bypass'], default_perm_mode: 'auto-edit' };
assert.equal(permissionFor('codex', cat, {provider:'claude',perm_mode:'bypass'}), 'auto-edit');
assert.equal(permissionFor('codex', cat, {provider:'codex',perm_mode:'suggest'}), 'suggest');
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
