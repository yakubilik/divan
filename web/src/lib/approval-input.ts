export type ApprovalResponse = { content: Record<string, unknown> | null } | { answers: Record<string, { answers: string[] }> };
export type Field = { id: string; label: string; description?: string; type: string; required: boolean; secret?: boolean; freeText?: boolean; choices?: { value: any; label: string }[] };
export function structuredInput(input: any): boolean {
  return input?.kind === 'mcp_elicitation' || input?.kind === 'user_input';
}
export function approvalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? value : null; } catch { return null; }
}
export function approvalFields(input: any): Field[] | null {
  if (input?.kind === 'user_input') {
    if (!Array.isArray(input.questions) || !input.questions.length) return null;
    return input.questions.map((q: any) => ({ id: q.id, label: q.question, description: q.header, type: 'answer', required: true,
      secret: !!q.isSecret, freeText: !q.options?.length || !!q.isOther, choices: q.options?.map((o: any) => ({ value: o.label, label: `${o.label}${o.description ? ` — ${o.description}` : ''}` })) }));
  }
  const s = input?.requestedSchema;
  if (input?.mode !== 'form' || !s || s.type !== 'object' || !s.properties || s.oneOf || s.anyOf || s.allOf || s.$ref) return null;
  const fields: Field[] = [];
  for (const [id, value] of Object.entries(s.properties)) {
    const f = value as any;
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(f.type) || f.$ref || f.anyOf || f.allOf) return null;
    let choices = f.enum?.map((v: any) => ({ value: v, label: String(v) }));
    if (f.oneOf) {
      if (!Array.isArray(f.oneOf) || f.oneOf.some((o: any) => !Object.prototype.hasOwnProperty.call(o, 'const'))) return null;
      choices = f.oneOf.map((o: any) => ({ value: o.const, label: o.title ?? String(o.const) }));
    }
    if (f.type === 'array') {
      if (f.items?.type !== 'string' || !Array.isArray(f.items.enum)) return null;
      choices = f.items.enum.map((v: string) => ({ value: v, label: v }));
    }
    if (f.type === 'boolean' && !choices) choices = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
    fields.push({ id, label: f.title ?? id, description: f.description, type: f.type, required: s.required?.includes(id) ?? false,
      secret: f.format === 'password' || f.writeOnly === true, choices });
  }
  return fields;
}
export function approvalResponse(input: any, fields: Field[] | null, values: Record<string, any>): ApprovalResponse | null {
  if (input?.mode === 'url') return approvalUrl(input.url) ? { content: null } : null;
  if (!fields) return null;
  const content: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
      if (field.required) return null;
      continue;
    }
    if (field.type === 'integer' || field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isInteger(number))) return null;
      content[field.id] = number;
    } else content[field.id] = value;
  }
  return input.kind === 'user_input'
    ? { answers: Object.fromEntries(Object.entries(content).map(([id, value]) => [id, { answers: [String(value)] }])) }
    : { content };
}
