import { z } from 'zod';

/**
 * Field types Master Admin can put on a custom module (arch doc §12).
 * Each maps to one input in the UI and one validator here.
 */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'select', 'checkbox', 'email', 'phone', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Choices for a select field. */
  options?: string[];
}

export const fieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field keys are lowercase letters, digits and underscores'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

export const definitionSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).nullish(),
    icon: z.string().trim().max(40).default('Blocks'),
    fields: z.array(fieldDefSchema).min(1, 'Add at least one field').max(30),
    statuses: z.array(z.string().trim().min(1).max(40)).min(1, 'Add at least one status').max(20),
    scopeEvent: z.boolean().default(true),
    scopeTeam: z.boolean().default(true),
  })
  .refine((d) => new Set(d.fields.map((f) => f.key)).size === d.fields.length, { message: 'Field keys must be unique' })
  .refine((d) => d.fields.every((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0), {
    message: 'A choice field needs at least one option',
  });

export type DefinitionInput = z.infer<typeof definitionSchema>;

/** "Sponsorship Tracker" → "custom_sponsorship_tracker" */
export function moduleKeyFor(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return `custom_${slug || 'module'}`;
}

/** The four permissions every custom module gets, mirroring the built-in ones. */
export function permissionsFor(moduleKey: string, name: string) {
  return [
    { key: `${moduleKey}.view`, description: `View ${name}` },
    { key: `${moduleKey}.create`, description: `Add ${name} records` },
    { key: `${moduleKey}.update`, description: `Edit ${name} records` },
    { key: `${moduleKey}.delete`, description: `Delete ${name} records` },
  ];
}

/**
 * Builds a validator for one module's record data from its field definitions,
 * so a custom module gets the same input checking as a hand-written one.
 */
export function buildRecordSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let rule: z.ZodTypeAny;
    switch (field.type) {
      case 'number':
      case 'money':
        rule = z.coerce.number();
        break;
      case 'checkbox':
        rule = z.coerce.boolean();
        break;
      case 'date':
        rule = z.coerce.date();
        break;
      case 'email':
        rule = z.string().trim().email();
        break;
      case 'url':
        rule = z.string().trim().url();
        break;
      case 'select':
        rule = z.enum((field.options ?? ['']) as [string, ...string[]]);
        break;
      case 'textarea':
        rule = z.string().trim().max(5000);
        break;
      default:
        rule = z.string().trim().max(500);
    }
    // An optional field accepts empty input and stores nothing.
    shape[field.key] = field.required ? rule : rule.nullish().or(z.literal(''));
  }

  return z.object(shape);
}
