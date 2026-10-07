import pkg from '../package.json' with { type: 'json' };

export const ENGINE_VERSION: string = pkg.version;
