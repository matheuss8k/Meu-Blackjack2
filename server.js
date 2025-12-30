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

// --- MODELO DO USUÁRIO ---
const UsuarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    saldo: { type: Number, default: 0 }
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
    } catch (err) {
        res.status(500).json({ erro: "Erro ao registrar usuário." });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ erro: "Usuário não encontrado." });

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(400).json({ erro: "Senha incorreta." });

        res.json({ id: usuario._id, nome: usuario.nome, email: usuario.email, saldo: usuario.saldo });
    } catch (err) {
        res.status(500).json({ erro: "Erro ao fazer login." });
    }
});

app.post('/atualizar-saldo', async (req, res) => {
    try {
        const { email, novoSaldo } = req.body;
        const usuario = await Usuario.findOneAndUpdate({ email }, { saldo: novoSaldo }, { new: true });
        res.json({ mensagem: "Saldo atualizado!", saldo: usuario.saldo });
    } catch (err) {
        res.status(500).json({ erro: "Erro ao sincronizar saldo." });
    }
});

// --- ROTA PARA GERAR PIX (ATUALIZADA COM METADADOS) ---
app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email, nome } = req.body;

        const paymentData = {
            body: {
                transaction_amount: Number(valor),
                description: 'Deposito de Fichas - Blackjack',
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: nome || 'Jogador',
                    last_name: 'Cliente' 
                },
                // RESOLVE AS PENDÊNCIAS DE ITENS DO MERCADO PAGO
                additional_info: {
                    items: [
                        {
                            id: 'fichas-blackjack-01',
                            title: 'Fichas Virtuais Blackjack',
                            description: 'Crédito de fichas para jogo de Blackjack',
                            category_id: 'virtual_goods', 
                            quantity: 1,
                            unit_price: Number(valor)
                        }
                    ]
                }
            },
        };

        const result = await payment.create(paymentData);
        res.json({
            copia_e_cola: result.point_of_interaction.transaction_data.qr_code,
            imagem_qr: result.point_of_interaction.transaction_data.qr_code_base64
        });

    } catch (error) {
        console.error("Erro ao gerar PIX:", error);
        res.status(500).json({ erro: "Erro ao gerar PIX" });
    }
});

// --- ROTA PARA PROCESSAR CARTÃO (ATUALIZADA COM DEVICE ID E METADADOS) ---
app.post('/processar-cartao', async (req, res) => {
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, device_id } = req.body;

        const paymentData = {
            body: {
                token,
                issuer_id,
                payment_method_id,
                transaction_amount: Number(transaction_amount),
                installments: Number(installments),
                description: 'Compra de Fichas - Blackjack',
                payer: { email: payer.email },
                // RESOLVE AS PENDÊNCIAS DE ITENS
                additional_info: {
                    items: [
                        {
                            id: 'fichas-blackjack-01',
                            title: 'Fichas Virtuais Blackjack',
                            description: 'Crédito de fichas para jogo de Blackjack',
                            category_id: 'virtual_goods',
                            quantity: 1,
                            unit_price: Number(transaction_amount)
                        }
                    ]
                }
            },
            // RESOLVE A AÇÃO OBRIGATÓRIA: IDENTIFICADOR DE DISPOSITIVO
            headers: {
                'X-Meli-Session-Id': device_id 
            }
        };

        const result = await payment.create(paymentData);

        if (result.status === 'approved') {
            const usuarioAtualizado = await Usuario.findOneAndUpdate(
                { email: payer.email },
                { $inc: { saldo: Number(transaction_amount) } },
                { new: true }
            );
            return res.json({ status: 'approved', novoSaldo: usuarioAtualizado.saldo });
        }
        res.json({ status: result.status, status_detail: result.status_detail });

    } catch (error) {
        console.error("Erro no processamento de cartão:", error);
        res.status(500).json({ erro: error.message });
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.query.id || (req.body.data && req.body.data.id);
        if (paymentId && paymentId !== '123456') {
            const pagamento = await payment.get({ id: paymentId });
            if (pagamento.status === 'approved') {
                await Usuario.findOneAndUpdate(
                    { email: pagamento.payer.email },
                    { $inc: { saldo: pagamento.transaction_amount } }
                );
            }
        }
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(200);
    }
});

app.get('/', (req, res) => res.send("Servidor Blackjack Ativo!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});