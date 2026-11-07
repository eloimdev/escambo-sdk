// npm i express github:eloimdev/escambo-sdk#v0.6.1
import express from 'express';
import {criarEscambo} from '@rande/escambo';

const app = express();
const escambo = criarEscambo();      // lê ESCAMBO_APP_ID e ESCAMBO_SEGREDO do ambiente
app.use(escambo.middleware);         // ANTES do express.json(): /fim e /revogar conferem a assinatura nos bytes do corpo
app.use(express.json());
escambo.iniciar();                   // avisa o Escambo que está no ar

app.get('/', (req, res) => res.send('Meu SaaS'));
app.listen(3000);
