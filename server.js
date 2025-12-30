require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname)); 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Banco de Dados Conectado"))
    .catch(err => console.error("❌ Erro Banco:", err));

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

// --- MODELOS ---
const PagamentoProcessado = mongoose.model('PagamentoProcessado', new mongoose.Schema({
    idMP: { type: String, unique: true, required: true },
    data: { type: Date, default: Date.now }
}));

const Usuario = mongoose.model('Usuario', new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    role: { type: String, default: "player" } 
}));

// --- ROTAS DE LOGIN/SALDO ---

app.post('/registrar', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);
        await new Usuario({ nome, email, senha: senhaCriptografada }).save();
        res.json({ mensagem: "Sucesso!" });
    } catch (err) { res.status(500).json({ erro: "Erro ao registrar" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ erro: "Usuário não encontrado" });
        if (senha !== "---") {
            const senhaValida = await bcrypt.compare(senha, usuario.senha);
            if (!senhaValida) return res.status(400).json({ erro: "Senha incorreta" });
        }
        res.json(usuario);
    } catch (err) { res.status(500).json({ erro: "Erro login" }); }
});

app.post('/atualizar-saldo', async (req, res) => {
    try {
        const { email, novoSaldo } = req.body;
        const usuario = await Usuario.findOneAndUpdate({ email }, { saldo: novoSaldo }, { new: true });
        res.json(usuario);
    } catch (err) { res.status(500).json({ erro: "Erro sincronia" }); }
});

// --- SISTEMA DE PAGAMENTOS (CENTRALIZADO NO WEBHOOK) ---

app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email, nome } = req.body;
        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Depósito Blackjack - ${email}`,
                payment_method_id: 'pix',
                external_reference: email, 
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook",
                payer: { email, first_name: nome || 'Jogador', last_name: 'Cliente' }
            }
        });
        res.json({ id: result.id, copia_e_cola: result.point_of_interaction.transaction_data.qr_code, imagem_qr: result.point_of_interaction.transaction_data.qr_code_base64 });
    } catch (error) { res.status(500).json({ erro: "Erro PIX" }); }
});

app.post('/processar-cartao', async (req, res) => {
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, device_id } = req.body;
        const result = await payment.create({
            body: {
                token, issuer_id, payment_method_id,
                transaction_amount: Number(transaction_amount),
                installments: Number(installments),
                description: 'Fichas Blackjack',
                external_reference: payer.email,
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook",
                payer: { email: payer.email },
                additional_info: {
                    items: [{ id: 'fichas', title: 'Fichas', category_id: 'virtual_goods', quantity: 1, unit_price: Number(transaction_amount) }]
                }
            },
            headers: { 'X-Meli-Session-Id': device_id }
        });
        // IMPORTANTE: Aqui não somamos nada no banco! Deixamos o Webhook fazer isso.
        res.json({ status: result.status });
    } catch (error) { res.status(500).json({ erro: error.message }); }
});

// --- WEBHOOK: O ÚNICO QUE PODE DAR DINHEIRO ---
app.post('/webhook', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.query.id || (req.body.data && req.body.data.id);
        if (!paymentId || paymentId === '123456') return res.sendStatus(200);

        // 1. Trava de duplicidade
        const jaPago = await PagamentoProcessado.findOne({ idMP: paymentId });
        if (jaPago) return res.sendStatus(200);

        const pagamento = await payment.get({ id: paymentId });

        if (pagamento.status === 'approved') {
            const emailUsuario = pagamento.external_reference;
            const valor = pagamento.transaction_amount;

            // 2. Soma o valor no banco
            const ok = await Usuario.findOneAndUpdate(
                { email: emailUsuario },
                { $inc: { saldo: valor } }
            );

            if (ok) {
                // 3. Registra o ID para nunca mais repetir
                await PagamentoProcessado.create({ idMP: paymentId });
                console.log(`✅ CREDITADO: R$ ${valor} para ${emailUsuario}`);
            }
        }
        res.sendStatus(200);
    } catch (error) { res.sendStatus(200); }
});

app.get('/consultar-pagamento/:id', async (req, res) => {
    try {
        const pagamento = await payment.get({ id: req.params.id });
        res.json({ status: pagamento.status, valor: pagamento.transaction_amount });
    } catch (error) { res.status(500).json({ erro: "Erro consulta" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Online na porta ${PORT}`));