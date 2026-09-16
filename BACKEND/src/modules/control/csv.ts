/** Parses the bulk-invite sheet: email, name, department, role (header row optional). */

export interface InviteRow {
  line: number;
  email: string;
  name: string;
  department: string | null;
  role: string | null;
}

export interface ParsedInvites {
  rows: InviteRow[];
  errors: { line: number; message: string }[];
}

/** Splits one CSV line, honouring quoted fields and doubled quotes. Tabs work too (pasted from Sheets). */
export function splitLine(line: string): string[] {
  const delimiter = line.includes('\t') && !line.includes(',') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseInvites(text: string, maxRows = 500): ParsedInvites {
  const rows: InviteRow[] = [];
  const errors: ParsedInvites['errors'] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const [emailRaw = '', nameRaw = '', dept = '', role = ''] = splitLine(raw);
    const email = emailRaw.toLowerCase();
    if (index === 0 && email === 'email') return; // header row

    if (!EMAIL.test(email)) return void errors.push({ line, message: `"${emailRaw}" is not an email address` });
    if (nameRaw.length < 2) return void errors.push({ line, message: 'Name is missing' });
    if (seen.has(email)) return void errors.push({ line, message: `${email} appears twice` });
    if (rows.length >= maxRows) return void errors.push({ line, message: `Only ${maxRows} people per import` });

    seen.add(email);
    rows.push({ line, email, name: nameRaw, department: dept || null, role: role || null });
  });

  return { rows, errors };
}
