// --- 1. CONFIGURAÇÕES E VARIÁVEIS GLOBAIS ---
// Substitua pela sua Chave Pública (Public Key) do Mercado Pago
const API_URL = "https://blackjack-matheus-oficial.onrender.com/";
const mp = new MercadoPago('APP_USR-200fec89-34ca-4a32-b5af-9293167ab200'); 

let baralho = [];
let cartaOcultaObjeto = null;
let saldoReal = 0;
let apostaAtual = 0;
let jogoEmAndamento = false;
let usuarioLogado = null;
let modoCadastro = false;

let pontosJogador = 0; pontosDealer = 0;
let asesJogador = 0; asesDealer = 0;

const naipes = ["C", "D", "H", "S"];
const valores = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

// --- 2. INICIALIZAÇÃO E SESSÃO ---

window.onload = function() {
    const usuarioSessao = localStorage.getItem("usuario_blackjack");
    if (usuarioSessao) {
        usuarioLogado = JSON.parse(usuarioSessao);
        saldoReal = usuarioLogado.saldo;
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("balance").innerText = saldoReal;
        atualizarHeaderUsuario(); 
    }
    
    document.getElementById("hit-button").onclick = pedirCarta;
    document.getElementById("stand-button").onclick = parar;
    document.getElementById("reset-button").onclick = iniciarRodadaComAposta;
    
    // Botões de jogo começam escondidos
    document.getElementById("hit-button").classList.add("escondido");
    document.getElementById("stand-button").classList.add("escondido");
};

// --- 3. SISTEMA DE LOGIN ---

async function fazerLogin() {
    const email = document.getElementById("user-email").value;
    const senha = document.getElementById("user-pass").value;
    const nome = document.getElementById("user-name").value;

    if (!email || !senha) return alert("Preencha e-mail e senha!");

    const rota = modoCadastro ? '/registrar' : '/login';
    const corpo = modoCadastro ? { email, senha, nome } : { email, senha };

    try {
        const resposta = await fetch(`API_URL${rota}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });
        const dados = await resposta.json();

        if (dados.erro) return alert(dados.erro);

        if (modoCadastro) {
            alert("Conta criada! Clique em entrar.");
            toggleLogin();
        } else {
            // CORREÇÃO: Salvando os dados retornados corretamente
            usuarioLogado = dados;
            localStorage.setItem("usuario_blackjack", JSON.stringify(dados));
            saldoReal = dados.saldo;
            document.getElementById("balance").innerText = saldoReal;
            document.getElementById("login-screen").style.display = "none";
            atualizarHeaderUsuario();
        }
    } catch (err) { alert("Erro ao conectar ao servidor."); }
}

function toggleLogin() {
    modoCadastro = !modoCadastro;
    document.getElementById("login-title").innerText = modoCadastro ? "Criar Conta" : "Entrar no Cassino";
    document.getElementById("user-name").style.display = modoCadastro ? "block" : "none";
    document.getElementById("btn-login").innerText = modoCadastro ? "Cadastrar" : "Entrar";
    document.getElementById("toggle-text").innerText = modoCadastro ? "Já tem conta? Entre aqui" : "Não tem conta? Cadastre-se";
}

function atualizarHeaderUsuario() {
    if (usuarioLogado) {
        document.getElementById("user-header").style.display = "flex";
        document.getElementById("display-user-name").innerText = usuarioLogado.nome;
    }
}

function logout() { localStorage.removeItem("usuario_blackjack"); location.reload(); }

// --- 4. SISTEMA DE APOSTAS ---

function apostar(valor) {
    if (jogoEmAndamento) return;
    if (saldoReal >= valor) {
        saldoReal -= valor; 
        apostaAtual += valor;
        atualizarInterfaceDinheiro();
    } else { alert("Saldo insuficiente!"); }
}

function limparAposta() {
    if (jogoEmAndamento) return;
    saldoReal += apostaAtual; 
    apostaAtual = 0;
    atualizarInterfaceDinheiro();
}

function atualizarInterfaceDinheiro() {
    document.getElementById("balance").innerText = saldoReal;
    document.getElementById("current-bet").innerText = apostaAtual;
}

// --- 5. LÓGICA DO JOGO ---

function iniciarRodadaComAposta() {
    if (apostaAtual <= 0) return alert("Aposte fichas primeiro!");
    
    pontosJogador = 0; pontosDealer = 0; asesJogador = 0; asesDealer = 0;
    cartaOcultaObjeto = null; jogoEmAndamento = true;

    limparMesa(); 

    document.getElementById("hit-button").classList.remove("escondido");
    document.getElementById("stand-button").classList.remove("escondido");
    document.getElementById("hit-button").disabled = false;
    document.getElementById("stand-button").disabled = false;
    document.getElementById("chips-area").classList.add("escondido");
    document.getElementById("reset-button").classList.add("escondido");

    criarBaralho(); 
    embaralharBaralho();

    setTimeout(() => darCartaPara("jogador"), 200);
    setTimeout(() => darCartaPara("dealer"), 1000);
    setTimeout(() => darCartaPara("jogador"), 1800);
    setTimeout(() => darCartaPara("dealer"), 2600);
}

function darCartaPara(quem) {
    if (baralho.length === 0) return;
    let carta = baralho.pop();
    let valor = pegarValor(carta);
    let partes = carta.split("-");
    const simbolos = { "C": "♣", "D": "♦", "H": "♥", "S": "♠" };

    let container = document.createElement("div");
    container.classList.add("card-container");
    if (partes[1] === "H" || partes[1] === "D") container.classList.add("red");

    let tagCarta = document.createElement("div");
    tagCarta.classList.add("card");
    tagCarta.innerHTML = `<div class="card-back"></div><div class="card-front"><div>${partes[0]}</div><div>${simbolos[partes[1]]}</div></div>`;
    container.appendChild(tagCarta);

    if (quem == "jogador") {
        setTimeout(() => tagCarta.classList.add("flipped"), 200);
        pontosJogador += valor;
        if (partes[0] === "A") asesJogador += 1;
        while (pontosJogador > 21 && asesJogador > 0) { pontosJogador -= 10; asesJogador -= 1; }
        document.getElementById("player-cards").appendChild(container);
        document.getElementById("player-score").innerText = formatarPlacar(pontosJogador, asesJogador);
    } else {
        pontosDealer += valor;
        if (partes[0] === "A") asesDealer += 1;
        while (pontosDealer > 21 && asesDealer > 0) { pontosDealer -= 10; asesDealer -= 1; }
        let total = document.getElementById("dealer-cards").children.length;
        if (total === 1) cartaOcultaObjeto = tagCarta;
        else setTimeout(() => tagCarta.classList.add("flipped"), 200);
        document.getElementById("dealer-cards").appendChild(container);
        if (total === 0) document.getElementById("dealer-score").innerText = formatarPlacar(pontosDealer, asesDealer);
    }
}

function pegarValor(c) {
    let v = c.split("-")[0];
    if (isNaN(v)) return (v === "A") ? 11 : 10;
    return parseInt(v);
}

function pedirCarta() {
    darCartaPara("jogador");
    if (pontosJogador > 21) {
        document.getElementById("hit-button").disabled = true;
        document.getElementById("stand-button").disabled = true;
        setTimeout(() => { finalizarRodada("perdeu"); }, 1000);
    }
}

async function parar() {
    document.getElementById("hit-button").disabled = true;
    document.getElementById("stand-button").disabled = true;

    if (cartaOcultaObjeto) cartaOcultaObjeto.classList.add("flipped");
    document.getElementById("dealer-score").innerText = formatarPlacar(pontosDealer, asesDealer);

    await new Promise(r => setTimeout(r, 1000));
    while (pontosDealer < 17) {
        darCartaPara("dealer");
        document.getElementById("dealer-score").innerText = formatarPlacar(pontosDealer, asesDealer);
        await new Promise(r => setTimeout(r, 1200));
    }
    await new Promise(r => setTimeout(r, 1000));

    if (pontosDealer > 21 || pontosJogador > pontosDealer) finalizarRodada("ganhou");
    else if (pontosJogador < pontosDealer) finalizarRodada("perdeu");
    else finalizarRodada("empate");
}

function finalizarRodada(res) {
    jogoEmAndamento = false;
    document.getElementById("hit-button").classList.add("escondido");
    document.getElementById("stand-button").classList.add("escondido");
    document.getElementById("chips-area").classList.remove("escondido");
    document.getElementById("reset-button").classList.remove("escondido");

    if (res === "ganhou") { dispararCelebracao(); saldoReal += apostaAtual * 2; }
    else if (res === "empate") { document.getElementById("tie-overlay").style.display = "flex"; saldoReal += apostaAtual; }
    else { document.getElementById("defeat-overlay").style.display = "flex"; }

    apostaAtual = 0; 
    atualizarInterfaceDinheiro(); 
    sincronizarSaldoComBanco();
}

// --- 6. COMEMORAÇÕES E LIMPEZA ---

function dispararCelebracao() {
    document.getElementById("victory-overlay").style.display = "flex";
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
}

function fecharCelebracao() { document.getElementById("victory-overlay").style.display = "none"; limparMesa(); }
function fecharDerrota() { document.getElementById("defeat-overlay").style.display = "none"; limparMesa(); }
function fecharTie() { document.getElementById("tie-overlay").style.display = "none"; limparMesa(); }

function limparMesa() {
    document.getElementById("player-cards").innerHTML = "";
    document.getElementById("dealer-cards").innerHTML = "";
    document.getElementById("player-score").innerText = "0";
    document.getElementById("dealer-score").innerText = "0";
}

async function sincronizarSaldoComBanco() {
    if (!usuarioLogado) return;
    try {
        await fetch('API_URL/atualizar-saldo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: usuarioLogado.email, novoSaldo: saldoReal })
        });
        usuarioLogado.saldo = saldoReal;
        localStorage.setItem("usuario_blackjack", JSON.stringify(usuarioLogado));
    } catch (e) { console.log("Erro ao salvar saldo"); }
}

// --- 7. PAGAMENTOS (MERCADO PAGO) ---

function abrirModalDeposito() {
    document.getElementById("pix-modal").style.display = "flex";
    document.getElementById("pix-resultado").style.display = "none";
    document.getElementById("deposit-options").style.display = "block";
    document.getElementById("cardPaymentBrick_container").innerHTML = ""; 
}

function fecharModalPix() { document.getElementById("pix-modal").style.display = "none"; }

async function solicitarPix() {
    const valor = document.getElementById("pix-valor").value;
    if (!valor || valor <= 0) return alert("Digite um valor válido!");
    try {
        const resposta = await fetch('API_URL/gerar-pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: valor, email: usuarioLogado.email, nome: usuarioLogado.nome })
        });
        const dados = await resposta.json();
        document.getElementById("pix-img").src = `data:image/jpeg;base64,${dados.imagem_qr}`;
        document.getElementById("pix-copia-cola").value = dados.copia_e_cola;
        document.getElementById("pix-resultado").style.display = "block";
    } catch (err) { alert("Erro ao gerar PIX."); }
}

async function gerarFormularioCartao() {
    const valor = document.getElementById("pix-valor").value;
    if (!valor || valor <= 0) return alert("Digite um valor válido!");

    document.getElementById("deposit-options").style.display = "none";
    const bricksBuilder = mp.bricks();
    
    window.cardPaymentBrickController = await bricksBuilder.create('cardPayment', 'cardPaymentBrick_container', {
        initialization: { amount: Number(valor), payer: { email: usuarioLogado.email } },
        callbacks: {
            onReady: () => { console.log("Formulário Pronto"); },
            onError: (err) => { console.error(err); alert("Erro ao carregar cartão."); },
            onSubmit: (cardFormData) => {
                return new Promise((resolve, reject) => {
                    fetch("API_URL/processar-cartao", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(cardFormData),
                    })
                    .then(res => res.json())
                    .then(dados => {
                        if (dados.status === "approved") {
                            // ATUALIZAÇÃO EM TEMPO REAL
                            saldoReal = dados.novoSaldo;
                            usuarioLogado.saldo = dados.novoSaldo;
                            localStorage.setItem("usuario_blackjack", JSON.stringify(usuarioLogado));
                            document.getElementById("balance").innerText = saldoReal;

                            alert("Pagamento Aprovado! Fichas adicionadas.");
                            fecharModalPix();
                            resolve();
                        } else {
                            alert("Pagamento Recusado.");
                            reject();
                        }
                    })
                    .catch(() => { alert("Erro no processamento."); reject(); });
                });
            }
        }
    });
}

function formatarPlacar(p, a) { return (a > 0 && p <= 21) ? `${p} / ${p - 10}` : p; }
function criarBaralho() { baralho = []; naipes.forEach(n => valores.forEach(v => baralho.push(v + "-" + n))); }
function embaralharBaralho() {
    for (let i = baralho.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
    }
}