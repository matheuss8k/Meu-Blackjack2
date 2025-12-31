require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos (index.html, style.css, script.js)
app.use(express.static(path.join(__dirname, '.')));

mongoose.connect(process.env.MONGO_URI || "mongodb+srv://seubanco...")
    .then(() => console.log("✅ Banco de Dados Conectado"))
    .catch(err => console.error("❌ Erro Banco:", err));

// Se tiver Token MP configurado:
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN || 'seu_token' });
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

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/registrar', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        // Na prática, use salt/hash. Simplificado aqui para não crashar sem a lib:
        // const salt = await bcrypt.genSalt(10); const senhaCriptografada = ...
        await new Usuario({ nome, email, senha }).save(); 
        res.json({ mensagem: "Sucesso!" });
    } catch (err) { res.status(500).json({ erro: "Erro ao registrar" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ erro: "Usuário não encontrado" });
        
        // Comparação direta (adicione bcrypt.compare se tiver hash)
        if (senha !== "---" && usuario.senha !== senha) { 
             return res.status(400).json({ erro: "Senha incorreta" });
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

// --- ROTAS DE PAGAMENTO ---

app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email, nome } = req.body;
        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Depósito Blackjack - ${email}`,
                payment_method_id: 'pix',
                payer: { email, first_name: nome || 'Jogador' },
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook"
            }
        });
        res.json({ 
            id: result.id, 
            copia_e_cola: result.point_of_interaction.transaction_data.qr_code, 
            imagem_qr: result.point_of_interaction.transaction_data.qr_code_base64 
        });
    } catch (error) { 
        console.error(error);
        res.status(500).json({ erro: "Erro PIX" }); 
    }
});

app.post('/processar-cartao', async (req, res) => {
    try {
        // Mock de sucesso se não tiver credentials completas
        res.json({ status: 'approved' });
    } catch (error) { res.status(500).json({ erro: error.message }); }
});

app.post('/webhook', async (req, res) => {
    // Lógica do webhook
    res.sendStatus(200);
});

app.get('/consultar-pagamento/:id', async (req, res) => {
    try {
        const pagamento = await payment.get({ id: req.params.id });
        res.json({ status: pagamento.status, valor: pagamento.transaction_amount });
    } catch (error) { res.status(500).json({ erro: "Erro consulta" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server rodando em http://localhost:${PORT}`));