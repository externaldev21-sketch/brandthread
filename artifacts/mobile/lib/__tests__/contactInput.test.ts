import { describe, expect, it } from 'vitest';
import { validEmailOrPhone } from '@/lib/contactInput';

describe('validEmailOrPhone', () => {
  it('accepts emails and phone / WhatsApp numbers', () => {
    expect(validEmailOrPhone(' studio@atelier.com ')).toBe('studio@atelier.com');
    expect(validEmailOrPhone('+44 7700 900123')).toBe('+44 7700 900123');
    expect(validEmailOrPhone('(415) 555-0134')).toBe('(415) 555-0134');
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'asdf', 'me@site', '12345', 'call me +1 415', '+1 234 567 890 123 456 78']) {
      expect(validEmailOrPhone(bad)).toBeNull();
    }
  });
});
