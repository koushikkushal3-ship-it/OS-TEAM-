import { parseInvites, splitLine } from './csv.js';

describe('bulk invite parsing', () => {
  it('handles quotes, commas inside quotes and tabs', () => {
    expect(splitLine('a@b.co,"Rao, Sai",Creative,Member')).toEqual(['a@b.co', 'Rao, Sai', 'Creative', 'Member']);
    expect(splitLine('a@b.co\tSai\tCreative')).toEqual(['a@b.co', 'Sai', 'Creative']);
    expect(splitLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('skips the header and blank lines, lowercases emails', () => {
    const { rows, errors } = parseInvites('email,name,department,role\n\nSAI@Mail.com,Sai,Creative,Content Team Member\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ line: 3, email: 'sai@mail.com', name: 'Sai', department: 'Creative', role: 'Content Team Member' }]);
  });

  it('reports bad rows by line without dropping the good ones', () => {
    const { rows, errors } = parseInvites('bad-email,Sai\nok@x.in,Okay\nok@x.in,Again\nfine@x.in,F');
    expect(rows.map((r) => r.email)).toEqual(['ok@x.in']);
    expect(errors.map((e) => e.line)).toEqual([1, 3, 4]);
  });
});
