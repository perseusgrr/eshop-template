import { setPageMetaInfo } from 'src/modules/cms/services/pageMetaInfo.js';

export default (request, response) => {
  setPageMetaInfo(request, {
    title: 'Create a new product',
    description: 'Create a new product'
  });
};
