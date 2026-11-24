import {onRequest} from 'firebase-functions/v2/https';
import {createConverterProxy} from './converter-proxy.mjs';
import {defineSecret,defineString} from 'firebase-functions/params';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {fileURLToPath} from 'node:url';
import {createGate} from './gate.mjs';
initializeApp();
const converterUrl=defineString('CONVERTER_URL',{default:''});
const converterSecret=defineSecret('CONVERTER_SECRET');
const owner=defineString('OWNER_UID',{default:''});
const origin=defineString('APP_ORIGIN',{default:''});
export const privateStudio=onRequest({region:'us-central1',maxInstances:3,secrets:[converterSecret],timeoutSeconds:60},createGate({
  converter:createConverterProxy({url:()=>converterUrl.value(),secret:()=>converterSecret.value()}),
  auth:getAuth(),ownerUid:()=>owner.value(),origin:()=>origin.value(),
  root:fileURLToPath(new URL('./site/',import.meta.url)),
  loginFile:fileURLToPath(new URL('./login.html',import.meta.url))
}));
