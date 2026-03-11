import { NAUKRI_APP_ID, NAUKRI_CLIENT_ID, NAUKRI_NK_PARAM } from '../../../utils/constants.js';

export const SOURCE = 'naukri';
export const PAGE_DELAY_MS = 1500;
export const HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
    "accept-language": "en-US,en;q=0.9",

  appid: NAUKRI_APP_ID,
  clientid: NAUKRI_CLIENT_ID,
  gid: 'LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE',
//nkparam: "bjmZgQ1KYEEF8oEOrLRThpiBFwFMrlbSYtkZxN6JECdk2QZJedV6HjUF3walAHpSyGeiR5oyiu1VufNQ18u1pQ==",
  systemid: '135',
};
export const NAUKRI_WORKER = 'NAUKRI_WORKER';
