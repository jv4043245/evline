import { sendCustomerDocument } from '../../../../_lib/document-send.js';

export const onRequestPost = context => sendCustomerDocument(context);
