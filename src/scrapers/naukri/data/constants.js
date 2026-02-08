import { NAUKRI_APP_ID, NAUKRI_CLIENT_ID, NAUKRI_NK_PARAM } from '../../../utils/constants.js';

export const SOURCE = 'naukri';
export const PAGE_DELAY_MS = 1500;
export const HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
  appid: NAUKRI_APP_ID,
  clientid: NAUKRI_CLIENT_ID,
  gid: 'LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE',
  nkparam: NAUKRI_NK_PARAM,
  systemid: 'Naukri',
};
export const NAUKRI_WORKER = 'NAUKRI_WORKER';
