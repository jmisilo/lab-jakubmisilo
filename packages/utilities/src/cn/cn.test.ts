import { cn } from '.';

describe('cn', () => {
  it('should return an empty string when no arguments are passed', () => {
    expect(cn()).toEqual('');
  });

  it('should concatenate class names when multiple arguments are passed', () => {
    expect(cn('foo', 'bar')).toEqual('foo bar');
  });

  it('should handle object arguments', () => {
    expect(cn({ foo: true, bar: false })).toEqual('foo');
    expect(cn({ foo: true, bar: false }, 'baz')).toEqual('foo baz');
  });

  it('should handle array arguments', () => {
    expect(cn(['foo', 'bar'])).toEqual('foo bar');
    expect(cn(['foo', { bar: true }])).toEqual('foo bar');
  });

  it('should handle combination of arguments', () => {
    expect(cn('foo', { bar: true }, ['baz', { qux: true }])).toEqual('foo bar baz qux');
  });

  it('should handle falsy arguments', () => {
    expect(cn('foo', null, undefined, false, 0, '', { bar: false }, [])).toEqual('foo');
  });
});
