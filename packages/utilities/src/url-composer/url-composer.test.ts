import { apiUrl, url, UrlComposer } from '.';

const SITE_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8080';

describe('UrlComposer', () => {
  it('should initialize with the provided domain and protocol', () => {
    const customDomain = 'custom.com';
    const customProtocol = 'http';

    const urlComposer = new UrlComposer(customDomain, customProtocol);

    expect(urlComposer['protocol']).toBe(customProtocol);
    expect(urlComposer['domain']).toBe(customDomain);
    expect(urlComposer['origin']).toBe(`${customProtocol}://${customDomain}`);
  });

  it('should initialize with the default domain & protocol', () => {
    const urlComposer = new UrlComposer();
    expect(urlComposer['origin']).toBe(SITE_URL);
  });

  it('should provide the default dev protocol', () => {
    const urlComposer = new UrlComposer();
    expect(urlComposer['protocol']).toBe('http');
  });

  it('should export the default web composer', () => {
    expect(url['origin']).toBe(SITE_URL);
  });

  it('should export the default api composer', () => {
    expect(apiUrl['origin']).toBe(API_URL);
  });

  it('should throw an error if the origin is invalid', () => {
    expect(() => new UrlComposer('invalid-url')).toThrow();
  });

  it('should compose pathname correctly', () => {
    const urlComposer = new UrlComposer();
    const pathname = urlComposer.composePathname('path', 'to', 'resource');
    expect(pathname).toBe('/path/to/resource');
  });

  it('should handle nullish values in path segments correctly', () => {
    const urlComposer = new UrlComposer();
    const pathname = urlComposer.composePathname('path', null, undefined, 'to', 'resource');
    expect(pathname).toBe('/path/to/resource');
  });

  it('should handle already connected path segments correctly', () => {
    const urlComposer = new UrlComposer();
    const pathname = urlComposer.composePathname('/path/to', '/complex/resource', 'ab2/c3', 'test');
    expect(pathname).toBe('/path/to/complex/resource/ab2/c3/test');
  });

  it('should create query string correctly', () => {
    const urlComposer = new UrlComposer();
    const queryString = urlComposer['createQueryString']({
      param1: 'value1',
      param2: 2,
      param3: true,
    });
    expect(queryString).toBe('param1=value1&param2=2&param3=true');
  });

  it('should handle nullish values in query params correctly', () => {
    const urlComposer = new UrlComposer();
    const queryString = urlComposer['createQueryString']({
      param1: 'value1',
      param2: null,
      param3: undefined,
      param4: 2,
    });
    expect(queryString).toBe('param1=value1&param4=2');
  });

  it('should return an empty query string if no params are provided', () => {
    const urlComposer = new UrlComposer();
    const queryString = urlComposer['createQueryString']();
    expect(queryString).toBe('');
  });

  it('should compose full URL correctly', () => {
    const urlComposer = new UrlComposer();
    const url = urlComposer.compose({
      pathSegments: ['path', 'to', 'resource'],
      queryParams: {
        param1: 'value1',
        param2: 2,
        param3: true,
        param4: null,
        param5: undefined,
      },
    });
    expect(url).toBe(`${SITE_URL}/path/to/resource?param1=value1&param2=2&param3=true`);
  });

  it('should compose URL without query params correctly', () => {
    const urlComposer = new UrlComposer();
    const url = urlComposer.compose({
      pathSegments: ['path', 'to', 'resource'],
    });
    expect(url).toBe(`${SITE_URL}/path/to/resource`);
  });

  it('should handle empty path segments array correctly', () => {
    const urlComposer = new UrlComposer();
    const url = urlComposer.compose({
      pathSegments: [],
      queryParams: {
        param1: 'value1',
      },
    });
    expect(url).toBe(`${SITE_URL}/?param1=value1`);
  });

  it('should handle empty query params object correctly', () => {
    const urlComposer = new UrlComposer();
    const url = urlComposer.compose({
      pathSegments: ['path', 'to', 'resource'],
      queryParams: {},
    });
    expect(url).toBe(`${SITE_URL}/path/to/resource`);
  });

  it('should handle special characters in path segments correctly', () => {
    const urlComposer = new UrlComposer();
    const pathname = urlComposer.composePathname('path', 'to', 'res@urce');
    expect(pathname).toBe('/path/to/res@urce');
  });

  it('should handle special characters in query params correctly', () => {
    const urlComposer = new UrlComposer();
    const queryString = urlComposer['createQueryString']({
      param1: 'value1',
      param2: 'val@ue2',
    });
    expect(queryString).toBe('param1=value1&param2=val%40ue2');
  });

  it('should handle numeric path segments correctly', () => {
    const urlComposer = new UrlComposer();
    const pathname = urlComposer.composePathname('path', '123', 'resource');
    expect(pathname).toBe('/path/123/resource');
  });

  it('should handle boolean query params correctly', () => {
    const urlComposer = new UrlComposer();
    const queryString = urlComposer['createQueryString']({
      param1: true,
      param2: false,
    });
    expect(queryString).toBe('param1=true&param2=false');
  });
});
