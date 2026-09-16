import { type FieldDef, buildRecordSchema, definitionSchema, moduleKeyFor, permissionsFor } from './field-schema.js';

const fields: FieldDef[] = [
  { key: 'company', label: 'Company', type: 'text', required: true },
  { key: 'value', label: 'Value', type: 'money', required: false },
  { key: 'tier', label: 'Tier', type: 'select', required: true, options: ['Gold', 'Silver'] },
  { key: 'contacted', label: 'Contacted', type: 'checkbox', required: false },
  { key: 'email', label: 'Email', type: 'email', required: false },
];

describe('moduleKeyFor', () => {
  it('turns a name into a namespaced module key', () => {
    expect(moduleKeyFor('Sponsorship Tracker')).toBe('custom_sponsorship_tracker');
    expect(moduleKeyFor('Media & PR')).toBe('custom_media_pr');
    expect(moduleKeyFor('???')).toBe('custom_module');
  });
});

describe('permissionsFor', () => {
  it('gives every custom module the same four permissions', () => {
    expect(permissionsFor('custom_x', 'X').map((p) => p.key)).toEqual([
      'custom_x.view',
      'custom_x.create',
      'custom_x.update',
      'custom_x.delete',
    ]);
  });
});

describe('definitionSchema', () => {
  const base = { name: 'Sponsorship Tracker', fields: [fields[0]], statuses: ['New', 'Confirmed'] };

  it('accepts a sound definition', () => {
    expect(definitionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects duplicate field keys', () => {
    const result = definitionSchema.safeParse({ ...base, fields: [fields[0], { ...fields[0] }] });
    expect(result.success).toBe(false);
  });

  it('rejects a choice field with no options', () => {
    const result = definitionSchema.safeParse({
      ...base,
      fields: [{ key: 'tier', label: 'Tier', type: 'select', required: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects field keys that are not safe identifiers', () => {
    expect(definitionSchema.safeParse({ ...base, fields: [{ ...fields[0], key: 'Company Name' }] }).success).toBe(false);
  });

  it('needs at least one field and one status', () => {
    expect(definitionSchema.safeParse({ ...base, fields: [] }).success).toBe(false);
    expect(definitionSchema.safeParse({ ...base, statuses: [] }).success).toBe(false);
  });
});

describe('buildRecordSchema', () => {
  const schema = buildRecordSchema(fields);

  it('accepts a filled record and coerces types', () => {
    const result = schema.safeParse({ company: 'Acme', value: '50000', tier: 'Gold', contacted: 'true', email: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe(50000);
      expect(result.data.contacted).toBe(true);
    }
  });

  it('requires the fields marked required', () => {
    expect(schema.safeParse({ tier: 'Gold' }).success).toBe(false);
    expect(schema.safeParse({ company: 'Acme' }).success).toBe(false);
  });

  it('lets optional fields be empty or missing', () => {
    expect(schema.safeParse({ company: 'Acme', tier: 'Silver' }).success).toBe(true);
    expect(schema.safeParse({ company: 'Acme', tier: 'Silver', value: '', email: '' }).success).toBe(true);
  });

  it('holds a choice field to its options', () => {
    expect(schema.safeParse({ company: 'Acme', tier: 'Bronze' }).success).toBe(false);
  });

  it('checks email shape when one is given', () => {
    expect(schema.safeParse({ company: 'Acme', tier: 'Gold', email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ company: 'Acme', tier: 'Gold', email: 'a@b.test' }).success).toBe(true);
  });
});
