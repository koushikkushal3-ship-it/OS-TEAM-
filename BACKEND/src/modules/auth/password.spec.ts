import { generatePassword, passwordProblem } from './password.js';

describe('passwords', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('Sunrise2026', 'sai@teamon.in')).toBeNull();
  });

  it('explains what is wrong in plain words', () => {
    expect(passwordProblem('abc12')).toMatch(/at least 8/);
    expect(passwordProblem('onlyletters')).toMatch(/letters and numbers/);
    expect(passwordProblem('12345678')).toMatch(/letters and numbers/);
    expect(passwordProblem('kushal2026x', 'kushal@gmail.com')).toMatch(/email name/);
  });

  it('generates passwords that pass the rules and avoid look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(passwordProblem(p)).toBeNull();
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });
});
