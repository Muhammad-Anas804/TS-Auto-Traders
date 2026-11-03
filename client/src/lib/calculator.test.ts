import { describe, expect, it } from 'vitest';
import { evaluate, formatResult } from './calculator';

describe('calculator evaluate', () => {
  it('does basic arithmetic with precedence', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('10/4')).toBe(2.5);
    expect(evaluate('7-10')).toBe(-3);
  });
  it('accepts the display symbols', () => {
    expect(evaluate('6×7')).toBe(42);
    expect(evaluate('9÷3')).toBe(3);
    expect(evaluate('5−8')).toBe(-3);
  });
  it('removes floating point noise', () => {
    expect(evaluate('0.1+0.2')).toBe(0.3);
    expect(evaluate('185*20')).toBe(3700);
  });
  it('handles percent like a shop calculator', () => {
    expect(evaluate('200+10%')).toBe(220);
    expect(evaluate('200-10%')).toBe(180);
    expect(evaluate('200*10%')).toBe(20);
    expect(evaluate('50%')).toBe(0.5);
  });
  it('matches invoice 5510 line 1: 525 less 12%', () => {
    expect(evaluate('525-12%')).toBe(462);
  });
  it('handles unary minus', () => {
    expect(evaluate('-5+2')).toBe(-3);
    expect(evaluate('3*-2')).toBe(-6);
  });
  it('returns null for incomplete or invalid input', () => {
    expect(evaluate('')).toBeNull();
    expect(evaluate('5+')).toBeNull();
    expect(evaluate('5/0')).toBeNull();
    expect(evaluate('(2+3')).toBeNull();
    expect(evaluate('2..3')).toBeNull();
    expect(evaluate('abc')).toBeNull();
  });
});

describe('formatResult', () => {
  it('groups thousands and trims decimals', () => {
    expect(formatResult(1234567.5)).toBe('1,234,567.5');
    expect(formatResult(1 / 3)).toBe('0.3333');
    expect(formatResult(-0)).toBe('0');
  });
});
