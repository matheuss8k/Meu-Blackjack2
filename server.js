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
    saldo: { type: Number, default: 0 },
    role: { type: String, default: "player" } // player ou admin
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

        res.json({ id: usuario._id, nome: usuario.nome, email: usuario.email, saldo: usuario.saldo, role: usuario.role });
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

// --- ROTA GERAR PIX (AJUSTADA PARA MÁXIMA ESTABILIDADE) ---
app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email, nome } = req.body;

        const paymentData = {
            body: {
                transaction_amount: Number(valor),
                description: `Recarga Blackjack - ${email}`,
                payment_method_id: 'pix',
                // ETIQUETA: Salva o e-mail do jogo dentro do PIX
                external_reference: email, 
                // Usamos o link DIRETO do Render para evitar erro 307 de redirecionamento
                notification_url: "https://blackjack-matheus-oficial.onrender.com/webhook",
                payer: {
                    email: email,
                    first_name: nome || 'Jogador',
                    last_name: 'Cliente'
                },
                additional_info: {
                    items: [
                        {
                            id: 'fichas-blackjack',
                            title: 'Fichas Blackjack',
                            category_id: 'virtual_goods',
                            quantity: 1,
                            unit_price: Number(valor)
                        }
                    ]
                }
            },
        };

        const result = await payment.create(paymentData);
        
        console.log(`✅ PIX Gerado para: ${email} (ID: ${result.id})`);

        res.json({
            id: result.id,
            copia_e_cola: result.point_of_interaction.transaction_data.qr_code,
            imagem_qr: result.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("❌ Erro ao gerar PIX:", error);
        res.status(500).json({ erro: "Erro ao gerar PIX" });
    }
});

// --- ROTA WEBHOOK (O ÚNICO QUE SALVA NO BANCO DE DADOS) ---
app.post('/webhook', async (req, res) => {
    try {
        // Captura o ID do pagamento enviado pelo Mercado Pago
        const paymentId = req.query['data.id'] || req.query.id || (req.body.data && req.body.data.id);

        console.log("🔔 Webhook recebeu notificação do ID:", paymentId);

        if (paymentId && paymentId !== '123456') {
            const pagamento = await payment.get({ id: paymentId });

            // SÓ SALVA SE O STATUS FOR APROVADO
            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                
                // PEGA O E-MAIL DA ETIQUETA (external_reference)
                // Isso ignora o e-mail do banco e usa o e-mail que o usuário logou no seu site
                const emailUsuarioNoJogo = pagamento.external_reference;

                console.log(`💰 PAGAMENTO CONFIRMADO: R$ ${valorPago} para ${emailUsuarioNoJogo}`);

                // ATUALIZAÇÃO NO MONGODB
                const usuario = await Usuario.findOneAndUpdate(
                    { email: emailUsuarioNoJogo },
                    { $inc: { saldo: valorPago } }, // Soma o valor ao saldo atual
                    { new: true }
                );

                if (usuario) {
                    console.log(`✅ SALDO ATUALIZADO NO BANCO: Novo saldo de ${usuario.nome} é R$ ${usuario.saldo}`);
                } else {
                    console.log(`❌ ERRO: Usuário ${emailUsuarioNoJogo} não existe no banco de dados.`);
                }
            }
        }
        res.sendStatus(200); // Responde OK para o Mercado Pago
    } catch (error) {
        console.error("❌ ERRO NO WEBHOOK:", error.message);
        res.sendStatus(200); 
    }
});

// --- ROTA CONSULTA (USADA PELO VIGIA DO SCRIPT.JS) ---
app.get('/consultar-pagamento/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pagamento = await payment.get({ id: id });
        res.json({ status: pagamento.status, valor: pagamento.transaction_amount });
    } catch (error) {
        res.status(500).json({ erro: "Erro ao consultar banco" });
    }
});

// --- ROTA CARTÃO (REVISADA COM DEVICE ID) ---
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
                description: 'Deposito de Fichas - Blackjack',
                external_reference: payer.email,
                notification_url: "https://www.primetcg.com.br/webhook",
                payer: { email: payer.email },
                additional_info: {
                    items: [
                        {
                            id: 'fichas-blackjack-01',
                            title: 'Fichas Blackjack',
                            category_id: 'virtual_goods',
                            quantity: 1,
                            unit_price: Number(transaction_amount)
                        }
                    ]
                }
            },
            headers: { 'X-Meli-Session-Id': device_id }
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
        res.status(500).json({ erro: error.message });
    }
});

// --- ROTA WEBHOOK (O CORAÇÃO DO RECEBIMENTO) ---
app.post('/webhook', async (req, res) => {
    try {
        const paymentId = req.query['data.id'] || req.query.id || (req.body.data && req.body.data.id);
        
        console.log("🔔 WEBHOOK: Notificação recebida para o ID:", paymentId);

        if (paymentId && paymentId !== '123456') {
            const pagamento = await payment.get({ id: paymentId });

            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                const emailUsuario = pagamento.external_reference; // Puxa o e-mail da etiqueta

                console.log(`💰 PAGAMENTO APROVADO: R$ ${valorPago} para ${emailUsuario}`);

                const usuario = await Usuario.findOneAndUpdate(
                    { email: emailUsuario },
                    { $inc: { saldo: valorPago } },
                    { new: true }
                );

                if (usuario) {
                    console.log(`✅ BANCO ATUALIZADO: Novo saldo de ${usuario.nome} é R$ ${usuario.saldo}`);
                } else {
                    console.log(`❌ ERRO: Usuário com e-mail ${emailUsuario} não encontrado no banco.`);
                }
            }
        }
        res.sendStatus(200); 
    } catch (error) {
        console.error("❌ ERRO NO WEBHOOK:", error.message);
        res.sendStatus(200); // Responde 200 sempre para o MP parar de tentar
    }
});

app.get('/', (req, res) => res.send("Servidor Blackjack Online!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});