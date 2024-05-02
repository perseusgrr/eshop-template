import touch from 'touch';
import { resolve } from 'path';
import { CONSTANTS } from '@evershop/evershop/src/lib/helpers.js';

export function watchPage(event) {
  if (event === 'add') {
    // TODO: Touching this file will trigger a rebuild of all pages. This is not optimized
    touch(
      resolve(
        CONSTANTS.MOLDULESPATH,
        '../components/common/react/client/Index.jsx'
      )
    );
  }
}
