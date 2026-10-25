# @mixcraft/config

Centralized tooling configuration for the MixCraft workspace.

## Exports

- `@mixcraft/config/eslint` — shared ESLint flat config (`baseConfig`)
- `@mixcraft/config/typescript` — base TypeScript compiler options
- `@mixcraft/config/prettier` — canonical Prettier settings

## Usage

```js
// eslint.config.mjs
import { baseConfig } from "@mixcraft/config/eslint";
export default baseConfig;
```

```json
{ "extends": "@mixcraft/config/typescript" }
```
