const API_URL = ""; 
// Token do MercadoPago (Pode deixar este de teste ou colocar o seu de produção)
const mp = new MercadoPago('APP_USR-200fec89-34ca-4a32-b5af-9293167ab200'); 

// Variáveis Globais
let usuarioLogado = null;
let modoCadastro = false;
let saldoReal = 0;
let apostaAtual = 0;
let jogoEmAndamento = false;

// Variáveis do Jogo
let baralho = [];
let cartaOcultaObjeto = null;
let pontosJogador = 0, pontosDealer = 0, asesJogador = 0, asesDealer = 0;

// Config Cartas
const naipes = ["C", "D", "H", "S"]; // Clubs, Diamonds, Hearts, Spades
const valores = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

// =======================
// 1. INICIALIZAÇÃO
// =======================
window.onload = function() {
    // Verifica se já tem usuário salvo
    const salvo = localStorage.getItem("usuario_blackjack");
    if (salvo) {
        usuarioLogado = JSON.parse(salvo);
        saldoReal = usuarioLogado.saldo;
        atualizarUI();
        document.getElementById("login-screen").classList.add("escondido");
        sincronizarSaldoBanco();
    }
    
    // Conecta botões Hit/Stand (Eles ficam escondidos, mas ativos)
    document.getElementById("hit-button").onclick = pedirCartaJogador;
    document.getElementById("stand-button").onclick = dealerJogar;
};

// =======================
// 2. LÓGICA DO JOGO
// =======================

function iniciarRodadaComAposta() {
    // Validações
    if (jogoEmAndamento) return;
    if (apostaAtual <= 0) return alert("Clique nas fichas para apostar!");
    if (apostaAtual > saldoReal) return alert("Saldo insuficiente para essa aposta.");

    // Configura o estado visual
    jogoEmAndamento = true;
    document.getElementById("reset-button").classList.add("escondido"); // Some botão Distribuir
    document.getElementById("chips-area").classList.add("escondido");   // Some Fichas

    // Limpa a mesa antiga
    pontosJogador = 0; pontosDealer = 0; asesJogador = 0; asesDealer = 0;
    document.getElementById("player-cards").innerHTML = "";
    document.getElementById("dealer-cards").innerHTML = "";
    document.getElementById("player-score").innerText = "0";
    document.getElementById("dealer-score-box").innerText = "0";
    cartaOcultaObjeto = null;

    // Gera novo baralho
    criarBaralho();

    // Distribuição com atraso (Animação)
    setTimeout(() => darCarta("jogador"), 100);
    setTimeout(() => darCarta("dealer", true), 800);  // Essa é a carta virada
    setTimeout(() => darCarta("jogador"), 1500);
    setTimeout(() => darCarta("dealer"), 2200);      // Carta aberta do dealer

    // Mostra os controles
    setTimeout(() => {
        document.getElementById("hit-button").classList.remove("escondido");
        document.getElementById("stand-button").classList.remove("escondido");
        document.getElementById("hit-button").disabled = false;
        document.getElementById("stand-button").disabled = false;
    }, 2500);
}

function pedirCartaJogador() {
    if (!jogoEmAndamento) return;
    darCarta("jogador");
    if (pontosJogador > 21) {
        finalizarJogo("perdeu");
    }
}

async function dealerJogar() {
    if (!jogoEmAndamento) return;
    
    // Bloqueia botões
    document.getElementById("hit-button").disabled = true;
    document.getElementById("stand-button").disabled = true;

    // 1. Revela a carta oculta
    if (cartaOcultaObjeto) {
        const divCarta = cartaOcultaObjeto.dom;
        divCarta.classList.add("flipped"); // Gira a carta visualmente
        atualizarPontuacao("dealer", cartaOcultaObjeto.valor, cartaOcultaObjeto.str);
        cartaOcultaObjeto = null;
    }

    // 2. Dealer compra até 17
    while (pontosDealer < 17) {
        await esperar(1000);
        darCarta("dealer");
    }

    // 3. Resultado Final
    await esperar(800);
    if (pontosDealer > 21) finalizarJogo("ganhou");      // Dealer estourou
    else if (pontosJogador > pontosDealer) finalizarJogo("ganhou");
    else if (pontosJogador < pontosDealer) finalizarJogo("perdeu");
    else finalizarJogo("empate");
}

// =======================
// 3. FUNÇÃO QUE DESENHA A CARTA
// =======================
function darCarta(quem, oculta = false) {
    if (baralho.length === 0) criarBaralho();
    
    // Pega carta do array
    const cardCode = baralho.pop(); // ex: "10-D" ou "K-S"
    const partes = cardCode.split("-");
    const valorStr = partes[0];
    const naipeLetra = partes[1];
    
    // Converte pra numero (A=11, K=10, etc)
    const valorNumerico = obterValorNumerico(valorStr);
    
    // Simbolo Visual (♥, ♠, etc) e Cor
    const naipeSimbolo = obterSimboloNaipe(naipeLetra);
    const corClass = (naipeLetra === "H" || naipeLetra === "D") ? "red" : "black";

    // Cria os elementos HTML
    const container = document.createElement("div");
    container.classList.add("card-container");
    
    const card = document.createElement("div");
    card.classList.add("card", corClass); // Adiciona cor: preto ou vermelho

    // Parte de TRÁS
    const backFace = document.createElement("div");
    backFace.className = "card-back";

    // Parte da FRENTE (Com Topo, Meio e Fim para alinhar bonito)
    const frontFace = document.createElement("div");
    frontFace.className = "card-front";
    frontFace.innerHTML = `
        <div class="card-top">
            <span>${valorStr}</span><span>${naipeSimbolo}</span>
        </div>
        <div class="card-center">${naipeSimbolo}</div>
        <div class="card-bottom">
            <span>${valorStr}</span><span>${naipeSimbolo}</span>
        </div>
    `;

    // Monta a carta
    card.appendChild(backFace);
    card.appendChild(frontFace);
    container.appendChild(card);

    // Coloca na mesa
    if (quem === "jogador") {
        document.getElementById("player-cards").appendChild(container);
        atualizarPontuacao("jogador", valorNumerico, valorStr);
        // Efeito de virar
        setTimeout(() => card.classList.add("flipped"), 100);
    
    } else { // Dealer
        document.getElementById("dealer-cards").appendChild(container);
        
        if (oculta) {
            // Guarda informação para usar depois (sem virar agora)
            cartaOcultaObjeto = { dom: card, valor: valorNumerico, str: valorStr };
        } else {
            // Carta normal do dealer (vira e soma)
            atualizarPontuacao("dealer", valorNumerico, valorStr);
            setTimeout(() => card.classList.add("flipped"), 100);
        }
    }
}

// =======================
// 4. AUXILIARES E UI
// =======================
function apostar(valor) {
    if (!jogoEmAndamento && saldoReal >= valor) {
        saldoReal -= valor;
        apostaAtual += valor;
        atualizarUI();
    } else if (saldoReal < valor) {
        alert("Saldo Insuficiente!");
    }
}

function limparAposta() {
    if (!jogoEmAndamento) {
        saldoReal += apostaAtual;
        apostaAtual = 0;
        atualizarUI();
    }
}

function finalizarJogo(resultado) {
    jogoEmAndamento = false;
    document.getElementById("hit-button").classList.add("escondido");
    document.getElementById("stand-button").classList.add("escondido");
    
    // Volta botão distribuir
    document.getElementById("reset-button").classList.remove("escondido");
    document.getElementById("chips-area").classList.remove("escondido");

    if (resultado === "ganhou") {
        saldoReal += (apostaAtual * 2);
        mostrarOverlay("victory-overlay");
        confetti({ spread: 100, origin: { y: 0.6 } });
    } else if (resultado === "empate") {
        saldoReal += apostaAtual;
        mostrarOverlay("tie-overlay");
    } else {
        mostrarOverlay("defeat-overlay");
    }

    apostaAtual = 0;
    atualizarUI();
    sincronizarSaldoBanco();
}

function atualizarUI() {
    document.getElementById("balance").innerText = saldoReal;
    document.getElementById("current-bet").innerText = apostaAtual;
    if (usuarioLogado) document.getElementById("display-user-name").innerText = usuarioLogado.nome;
}

function criarBaralho() {
    baralho = [];
    // 2-3... até 10, depois J, Q, K, A
    for (let naipe of naipes) {
        for (let val of valores) {
            baralho.push(val + "-" + naipe);
        }
    }
    // Embaralha
    baralho.sort(() => Math.random() - 0.5);
}

function obterValorNumerico(str) {
    if (["J", "Q", "K"].includes(str)) return 10;
    if (str === "A") return 11;
    return parseInt(str);
}

function obterSimboloNaipe(letra) {
    const mapa = { "H": "♥", "D": "♦", "C": "♣", "S": "♠" };
    return mapa[letra];
}

function atualizarPontuacao(quem, valor, strCarta) {
    if (quem === "jogador") {
        pontosJogador += valor;
        if (strCarta === "A") asesJogador++;
        // Lógica do Ás valendo 1 se estourar 21
        while (pontosJogador > 21 && asesJogador > 0) { pontosJogador -= 10; asesJogador--; }
        document.getElementById("player-score").innerText = pontosJogador;
    } else {
        pontosDealer += valor;
        if (strCarta === "A") asesDealer++;
        while (pontosDealer > 21 && asesDealer > 0) { pontosDealer -= 10; asesDealer--; }
        document.getElementById("dealer-score-box").innerText = pontosDealer;
    }
}

// Controle de Overlays (Vitória/Derrota)
function mostrarOverlay(id) { document.getElementById(id).classList.remove("escondido"); }
function fecharCelebracao() { document.getElementById("victory-overlay").classList.add("escondido"); }
function fecharDerrota() { document.getElementById("defeat-overlay").classList.add("escondido"); }
function fecharTie() { document.getElementById("tie-overlay").classList.add("escondido"); }
function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

// =======================
// 5. BANCO DE DADOS E LOGIN
// =======================
// ... Mesma lógica de Login que você já tem
async function fazerLogin() {
    const email = document.getElementById("user-email").value;
    const pass = document.getElementById("user-pass").value;
    const nome = document.getElementById("user-name").value;

    const rota = modoCadastro ? "/registrar" : "/login";
    try {
        const res = await fetch(`${API_URL}${rota}`, {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, senha: pass, nome })
        });
        const data = await res.json();
        
        if (data.erro) return alert(data.erro);
        
        if (modoCadastro) {
            alert("Conta criada!");
            toggleLogin();
        } else {
            usuarioLogado = data;
            saldoReal = data.saldo;
            localStorage.setItem("usuario_blackjack", JSON.stringify(data));
            document.getElementById("login-screen").classList.add("escondido");
            atualizarUI();
        }
    } catch(e) { console.error("Erro server", e); alert("Servidor offline?"); }
}
function toggleLogin() {
    modoCadastro = !modoCadastro;
    document.getElementById("user-name").style.display = modoCadastro ? "block" : "none";
    document.getElementById("btn-login").innerText = modoCadastro ? "CADASTRAR" : "ENTRAR";
}
function logout() { localStorage.removeItem("usuario_blackjack"); location.reload(); }
async function sincronizarSaldoBanco() {
    if(!usuarioLogado) return;
    try {
        fetch(`${API_URL}/atualizar-saldo`, {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({email: usuarioLogado.email, novoSaldo: saldoReal}) 
        });
    } catch(e){}
}
function abrirModalDeposito() { document.getElementById("pix-modal").classList.remove("escondido"); }
function fecharModalPix() { document.getElementById("pix-modal").classList.add("escondido"); }