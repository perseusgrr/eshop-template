import config from 'config';
import { existsSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import { CONSTANTS } from '@evershop/evershop/src/lib/helpers.js';
import { loadModuleRoutes } from '@evershop/evershop/src/lib/router/loadModuleRoutes.js';
import { getRoutes } from '@evershop/evershop/src/lib/router/Router.js';
import { isBuildRequired } from '@evershop/evershop/src/lib/webpack/isBuildRequired.js';
import { buildEntry } from '@evershop/evershop/bin/lib/buildEntry.js';
import { getCoreModules } from '@evershop/evershop/bin/lib/loadModules.js';
import { error } from '@evershop/evershop/src/lib/log/logger.js';
import { lockHooks } from '@evershop/evershop/src/lib/util/hookable.js';
import { lockRegistry } from '@evershop/evershop/src/lib/util/registry.js';
import { validateConfiguration } from '@evershop/evershop/src/lib/util/validateConfiguration.js';
import { compile } from './complie.js';
import { getEnabledExtensions } from '../extension/index.js';
import { loadBootstrapScript } from '../lib/bootstrap/bootstrap.js';
import 'dotenv/config';

/* Loading modules and initilize routes, components */
const modules = [...getCoreModules(), ...getEnabledExtensions()];

/** Loading routes  */
modules.forEach((module) => {
  try {
    // Load routes
    loadModuleRoutes(module.path);
  } catch (e) {
    error(e);
    process.exit(0);
  }
});

/** Clean up the build directory */
if (existsSync(path.resolve(CONSTANTS.BUILDPATH))) {
  // Delete directory recursively
  rmSync(path.resolve(CONSTANTS.BUILDPATH), { recursive: true });
  mkdirSync(path.resolve(CONSTANTS.BUILDPATH));
} else {
  mkdirSync(path.resolve(CONSTANTS.BUILDPATH), { recursive: true });
}

export default async () => {
  /** Loading bootstrap script from modules */
  try {
    // eslint-disable-next-line no-restricted-syntax
    for (const module of modules) {
      await loadBootstrapScript(module);
    }
    lockHooks();
    lockRegistry();
    // Get the configuration (nodeconfig)
    validateConfiguration(config);
  } catch (e) {
    error(e);
    process.exit(0);
  }
  process.env.ALLOW_CONFIG_MUTATIONS = false;

  const routes = getRoutes();
  await buildEntry(routes.filter((r) => isBuildRequired(r)));

  /** Build  */
  await compile(routes);
};
