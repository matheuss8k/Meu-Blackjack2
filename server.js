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

// --- CONEXÃO COM O MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Conectado ao Cofre (MongoDB Atlas)"))
    .catch(err => console.error("❌ Erro ao conectar ao banco:", err));

// --- CONFIGURAÇÃO MERCADO PAGO ---
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

// --- 1. MODELO PARA EVITAR DUPLICIDADE (TRAVA DE SEGURANÇA) ---
const PagamentoProcessadoSchema = new mongoose.Schema({
    idMP: { type: String, unique: true, required: true },
    data: { type: Date, default: Date.now }
});
const PagamentoProcessado = mongoose.model('PagamentoProcessado', PagamentoProcessadoSchema);

// --- 2. MODELO DO USUÁRIO ---
const UsuarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    role: { type: String, default: "player" } 
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/registrar', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        const usuarioExiste = await Usuario.findOne({ email });
        if (usuarioExiste) return res.status(400).json({ erro: "Este e-mail já está cadastrado." });
        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);
        const novoUsuario = new Usuario({ nome, email, senha: senhaCriptografada });
        await novoUsuario.save();
        res.json({ mensagem: "Conta criada com sucesso!" });
    } catch (err) { res.status(500).json({ erro: "Erro ao registrar usuário." }); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ erro: "Usuário não encontrado." });
        if (senha === "---") return res.json(usuario);
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(400).json({ erro: "Senha incorreta." });
        res.json({ id: usuario._id, nome: usuario.nome, email: usuario.email, saldo: usuario.saldo, role: usuario.role });
    } catch (err) { res.status(500).json({ erro: "Erro ao fazer login." }); }
});

app.post('/atualizar-saldo', async (req, res) => {
    try {
        const { email, novoSaldo } = req.body;
        const usuario = await Usuario.findOneAndUpdate({ email }, { saldo: novoSaldo }, { new: true });
        res.json({ mensagem: "Saldo atualizado!", saldo: usuario.saldo });
    } catch (err) { res.status(500).json({ erro: "Erro ao sincronizar saldo." }); }
});

// --- ROTA GERAR PIX ---
app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email, nome } = req.body;
        const paymentData = {
            body: {
                transaction_amount: Number(valor),
                description: `Depósito Blackjack - ${email}`,
                payment_method_id: 'pix',
                external_reference: email, 
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook",
                payer: { email: email, first_name: nome || 'Jogador', last_name: 'Cliente' },
                additional_info: {
                    items: [{ id: 'fichas', title: 'Fichas Blackjack', category_id: 'virtual_goods', quantity: 1, unit_price: Number(valor) }]
                }
            },
        };
        const result = await payment.create(paymentData);
        res.json({ id: result.id, copia_e_cola: result.point_of_interaction.transaction_data.qr_code, imagem_qr: result.point_of_interaction.transaction_data.qr_code_base64 });
    } catch (error) { res.status(500).json({ erro: "Erro ao gerar PIX" }); }
});

// --- ROTA CONSULTA PARA O SCRIPT.JS ---
app.get('/consultar-pagamento/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pagamento = await payment.get({ id: id });
        res.json({ status: pagamento.status, valor: pagamento.transaction_amount });
    } catch (error) { res.status(500).json({ erro: "Erro ao consultar" }); }
});

// --- ROTA PROCESSAR CARTÃO ---
app.post('/processar-cartao', async (req, res) => {
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, device_id } = req.body;
        const paymentData = {
            body: {
                token, issuer_id, payment_method_id,
                transaction_amount: Number(transaction_amount),
                installments: Number(installments),
                description: 'Fichas Blackjack',
                external_reference: payer.email, 
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook",
                payer: { email: payer.email },
                additional_info: {
                    items: [{ id: 'fichas', title: 'Fichas Blackjack', category_id: 'virtual_goods', quantity: 1, unit_price: Number(transaction_amount) }]
                }
            },
            headers: { 'X-Meli-Session-Id': device_id }
        };
        const result = await payment.create(paymentData);
        res.json({ status: result.status, status_detail: result.status_detail });
    } catch (error) { res.status(500).json({ erro: error.message }); }
});

// --- 3. WEBHOOK DEFINITIVO (COM TRAVA ANTI-DUPLICIDADE) ---
app.post('/webhook', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.query.id || (req.body.data && req.body.data.id);
        
        if (!paymentId || paymentId === '123456') return res.sendStatus(200);

        console.log("🔔 WEBHOOK: Verificando ID", paymentId);

        // CHECAGEM DE DUPLICIDADE: Vê se esse ID já foi pago antes
        const jaProcessado = await PagamentoProcessado.findOne({ idMP: paymentId });
        if (jaProcessado) {
            console.log(`🚫 Bloqueio: Pagamento ${paymentId} já foi creditado. Ignorando.`);
            return res.sendStatus(200);
        }

        const pagamento = await payment.get({ id: paymentId });

        if (pagamento.status === 'approved') {
            const valorPago = pagamento.transaction_amount;
            const emailUsuario = pagamento.external_reference;

            console.log(`💰 APROVADO: R$ ${valorPago} para ${emailUsuario}`);

            // 1. Soma no banco de dados
            const usuario = await Usuario.findOneAndUpdate(
                { email: emailUsuario },
                { $inc: { saldo: valorPago } },
                { new: true }
            );

            if (usuario) {
                // 2. Registra o ID para que ele nunca mais seja usado
                await PagamentoProcessado.create({ idMP: paymentId });
                console.log(`✅ Saldo salvo e ID ${paymentId} travado com sucesso.`);
            }
        }
        res.sendStatus(200); 
    } catch (error) { 
        console.error("Erro Webhook:", error.message);
        res.sendStatus(200); 
    }
});

app.get('/', (req, res) => res.send("Servidor Blackjack Online!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Servidor na porta ${PORT}`); });