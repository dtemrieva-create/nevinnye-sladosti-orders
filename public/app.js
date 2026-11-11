import {initCatalog} from './js/catalog.js';
import {initOrderForm} from './js/order-form.js';
import {initInteractions} from './js/interactions.js';
import {initMedia} from './js/media.js';

const config = window.PUBLIC_CONFIG;
initInteractions(config);
const selectCake = initOrderForm(config);
initCatalog(config, selectCake);
initMedia(config).catch(() => {});
