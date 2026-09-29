// Lançador do Painel Gerenciador — Sites Express.
//
// Sobe a API (que serve também a interface compilada), mostra se está no ar e
// guarda o log. Compilado pelo build.ps1 com o csc do .NET Framework 4, que já
// vem no Windows: nada a instalar além do Node. Por isso o C# aqui é o da
// versão 5 (sem interpolação de string nem operador ?.).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace PainelLauncher
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            bool primeiro;
            using (var mutex = new Mutex(true, "Joinvix.PainelSitesExpress.Lancador", out primeiro))
            {
                if (!primeiro)
                {
                    MessageBox.Show("O lançador já está aberto — procure o ícone na bandeja do Windows, perto do relógio.",
                        "Painel Sites Express", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                string raiz = Projeto.EncontrarRaiz();
                if (raiz == null)
                {
                    MessageBox.Show("Não encontrei a pasta do painel (a que tem server\\src\\index.js).\n\n" +
                        "Deixe o executável dentro da pasta do projeto ou recompile-o com launcher\\build.ps1.",
                        "Painel Sites Express", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
                Application.Run(new JanelaPrincipal(raiz));
            }
        }
    }

    /// <summary>Onde está o projeto e o que o .env diz sobre porta e rede.</summary>
    static class Projeto
    {
        public static string EncontrarRaiz()
        {
            var candidatas = new List<string>();
            var pasta = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (pasta != null) { candidatas.Add(pasta.FullName); pasta = pasta.Parent; }
            // Gravado na compilação: vale quando o .exe é copiado para outro lugar.
            candidatas.Add(Compilacao.RaizDoProjeto);
            foreach (var c in candidatas)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(Path.Combine(c, "server", "src", "index.js"))) return c;
            }
            return null;
        }

        public static Dictionary<string, string> LerEnv(string raiz)
        {
            var valores = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string arquivo = Path.Combine(raiz, ".env");
            if (!File.Exists(arquivo)) return valores;
            foreach (var linhaBruta in File.ReadAllLines(arquivo, Encoding.UTF8))
            {
                string linha = linhaBruta.Trim();
                if (linha.Length == 0 || linha.StartsWith("#")) continue;
                int igual = linha.IndexOf('=');
                if (igual <= 0) continue;
                string chave = linha.Substring(0, igual).Trim();
                if (chave.StartsWith("export ")) chave = chave.Substring(7).Trim();
                string valor = linha.Substring(igual + 1).Trim();
                if (valor.Length >= 2 && (valor[0] == '"' || valor[0] == '\'') && valor[valor.Length - 1] == valor[0])
                    valor = valor.Substring(1, valor.Length - 2);
                valores[chave] = valor;
            }
            return valores;
        }

        public static string AcharNode()
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var p in path.Split(';'))
            {
                try
                {
                    string c = Path.Combine(p.Trim().Trim('"'), "node.exe");
                    if (File.Exists(c)) return c;
                }
                catch (ArgumentException) { }
            }
            string padrao = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            return File.Exists(padrao) ? padrao : null;
        }

        /// <summary>A interface compilada é mais velha que o código dela?</summary>
        public static bool InterfaceDesatualizada(string raiz, out bool existe)
        {
            string index = Path.Combine(raiz, "web", "dist", "index.html");
            existe = File.Exists(index);
            if (!existe) return true;
            DateTime compilada = File.GetLastWriteTimeUtc(index);
            string web = Path.Combine(raiz, "web");
            var fontes = new List<string>();
            try { fontes.AddRange(Directory.GetFiles(Path.Combine(web, "src"), "*", SearchOption.AllDirectories)); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            foreach (var f in new[] { "index.html", "package.json", "vite.config.ts" }) fontes.Add(Path.Combine(web, f));
            foreach (var f in fontes)
            {
                if (File.Exists(f) && File.GetLastWriteTimeUtc(f) > compilada) return true;
            }
            return false;
        }

        /// <summary>O processo que escuta na porta, pelo netstat (0 se nenhum).</summary>
        public static int PidNaPorta(int porta)
        {
            try
            {
                var info = new ProcessStartInfo("netstat.exe", "-ano -p TCP")
                {
                    UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true
                };
                using (var p = Process.Start(info))
                {
                    string saida = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(5000);
                    var re = new Regex(@"^\s*TCP\s+\S+:" + porta + @"\s+\S+\s+\S+\s+(\d+)\s*$", RegexOptions.Multiline);
                    foreach (Match m in re.Matches(saida))
                    {
                        int pid = int.Parse(m.Groups[1].Value);
                        if (pid > 0) return pid;
                    }
                }
            }
            catch (Exception) { }
            return 0;
        }

        public static List<string> EnderecosDaRede()
        {
            var lista = new List<string>();
            try
            {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in nic.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        byte[] b = ua.Address.GetAddressBytes();
                        bool privado = b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
                        if (privado) lista.Add(ua.Address.ToString());
                    }
                }
            }
            catch (Exception) { }
            return lista;
        }
    }

    /// <summary>
    /// Job Object do Windows com "matar ao fechar": tudo o que o lançador sobe
    /// (Node, npm e os filhos deles) morre junto com ele, mesmo se ele for
    /// encerrado pelo Gerenciador de Tarefas. Sem isso, um Node órfão ficava
    /// segurando a porta.
    /// </summary>
    static class Trabalho
    {
        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimit
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimit
        {
            public BasicLimit BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        const int ExtendedLimitInformation = 9;
        const uint KillOnJobClose = 0x2000;

        static IntPtr job = IntPtr.Zero;

        public static void Vincular(Process p)
        {
            try
            {
                if (job == IntPtr.Zero)
                {
                    IntPtr novo = CreateJobObject(IntPtr.Zero, null);
                    var info = new ExtendedLimit();
                    info.BasicLimitInformation.LimitFlags = KillOnJobClose;
                    if (novo == IntPtr.Zero || !SetInformationJobObject(novo, ExtendedLimitInformation, ref info, Marshal.SizeOf(typeof(ExtendedLimit)))) return;
                    job = novo; // o handle fica aberto até o processo acabar — é ele que dispara a limpeza
                }
                AssignProcessToJobObject(job, p.Handle);
            }
            catch (Exception) { }
        }
    }

    enum Estado { Parado, Preparando, Iniciando, Rodando, Externo, Parando, Falhou }

    class JanelaPrincipal : Form
    {
        const int MaxLinhasLog = 3000;
        const long MaxBytesArquivoLog = 5 * 1024 * 1024;

        readonly string raiz;
        readonly string arquivoLog;
        readonly Preferencias prefs;

        Process servidor;
        Process tarefa;              // npm install / npm run build em andamento
        bool paradaPedida;
        bool sairDepoisDeParar;
        bool reiniciarDepoisDeParar;
        DateTime inicio;
        Estado estado = Estado.Parado;
        string detalheFalha = "";
        int porta = 3333;
        string host = "";
        int sondando;                // 1 enquanto uma verificação HTTP está em curso
        int avisos, erros;

        // Interface
        readonly Panel indicador = new Panel();
        readonly Label lblEstado = new Label();
        readonly Label lblDetalhe = new Label();
        readonly LinkLabel lnkEndereco = new LinkLabel();
        readonly Label lblRede = new Label();
        readonly Label lblInterface = new Label();
        readonly Label lblNode = new Label();
        readonly Label lblContagem = new Label();
        readonly Button btnIniciar = new Button();
        readonly Button btnParar = new Button();
        readonly Button btnReiniciar = new Button();
        readonly Button btnAbrir = new Button();
        readonly Button btnCompilar = new Button();
        readonly Button btnPasta = new Button();
        readonly CheckBox chkCompilar = new CheckBox();
        readonly CheckBox chkAutoIniciar = new CheckBox();
        readonly RichTextBox log = new RichTextBox();
        readonly NotifyIcon bandeja = new NotifyIcon();
        readonly ToolStripMenuItem menuIniciarParar = new ToolStripMenuItem();
        readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();

        public JanelaPrincipal(string raiz)
        {
            this.raiz = raiz;
            arquivoLog = Path.Combine(raiz, "painel.log");
            prefs = Preferencias.Carregar();

            Text = "Painel Sites Express";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(900, 640);
            MinimumSize = new Size(700, 480);
            Font = new Font("Segoe UI", 9.5f);
            BackColor = Color.White;

            MontarInterface();
            MontarBandeja();

            relogio.Interval = 2000;
            relogio.Tick += delegate { Verificar(); };
            relogio.Start();

            Shown += delegate
            {
                RelerEnv();
                AtualizarInfo();
                Registrar("Pasta do projeto: " + raiz, Tipo.Sistema);
                // A primeira verificação decide se já há um painel no ar antes de subir outro.
                Sondar(delegate(bool noAr)
                {
                    if (noAr) { MudarEstado(Estado.Externo); Registrar("Já há um painel respondendo na porta " + porta + " (iniciado fora do lançador).", Tipo.Aviso); }
                    else if (prefs.AutoIniciar) Iniciar();
                    else MudarEstado(Estado.Parado);
                });
            };
        }

        /* ---- Montagem da janela ---------------------------------------- */

        void MontarInterface()
        {
            var topo = new TableLayoutPanel
            {
                Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, RowCount = 1,
                Padding = new Padding(16, 14, 16, 6), BackColor = Color.FromArgb(248, 250, 252)
            };
            topo.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 34));
            topo.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            indicador.Size = new Size(20, 20);
            indicador.Margin = new Padding(0, 6, 8, 0);
            indicador.Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var b = new SolidBrush(CorDoEstado())) e.Graphics.FillEllipse(b, 1, 1, 17, 17);
            };
            topo.Controls.Add(indicador, 0, 0);

            var textos = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0) };
            lblEstado.AutoSize = true;
            lblEstado.Font = new Font("Segoe UI Semibold", 15f);
            lblEstado.Margin = new Padding(0);
            lblDetalhe.AutoSize = true;
            lblDetalhe.ForeColor = Color.FromArgb(71, 85, 105);
            lblDetalhe.Margin = new Padding(1, 0, 0, 6);
            textos.Controls.Add(lblEstado);
            textos.Controls.Add(lblDetalhe);

            var grade = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 2, 0, 0) };
            grade.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grade.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            AdicionarLinha(grade, "Endereço", lnkEndereco);
            AdicionarLinha(grade, "Na rede", lblRede);
            AdicionarLinha(grade, "Interface", lblInterface);
            AdicionarLinha(grade, "Node", lblNode);
            AdicionarLinha(grade, "Log", lblContagem);
            textos.Controls.Add(grade);
            topo.Controls.Add(textos, 1, 0);

            lnkEndereco.LinkClicked += delegate { AbrirNoNavegador(); };

            var barra = new FlowLayoutPanel
            {
                Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12, 6, 12, 4),
                BackColor = Color.FromArgb(248, 250, 252)
            };
            Botao(btnIniciar, "Iniciar", delegate { Iniciar(); });
            Botao(btnParar, "Parar", delegate { Parar(false, false); });
            Botao(btnReiniciar, "Reiniciar", delegate { Reiniciar(); });
            Botao(btnAbrir, "Abrir o painel", delegate { AbrirNoNavegador(); });
            Botao(btnCompilar, "Compilar a interface", delegate { CompilarManual(); });
            Botao(btnPasta, "Abrir a pasta", delegate { Process.Start("explorer.exe", "\"" + raiz + "\""); });
            barra.Controls.AddRange(new Control[] { btnIniciar, btnParar, btnReiniciar, btnAbrir, btnCompilar, btnPasta });

            var opcoes = new FlowLayoutPanel
            {
                Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(14, 0, 12, 8),
                BackColor = Color.FromArgb(248, 250, 252)
            };
            chkCompilar.Text = "Compilar a interface ao iniciar, se o código dela mudou";
            chkCompilar.AutoSize = true;
            chkCompilar.Checked = prefs.CompilarAoIniciar;
            chkCompilar.CheckedChanged += delegate { prefs.CompilarAoIniciar = chkCompilar.Checked; prefs.Salvar(); };
            chkAutoIniciar.Text = "Iniciar o painel ao abrir o lançador";
            chkAutoIniciar.AutoSize = true;
            chkAutoIniciar.Checked = prefs.AutoIniciar;
            chkAutoIniciar.CheckedChanged += delegate { prefs.AutoIniciar = chkAutoIniciar.Checked; prefs.Salvar(); };
            opcoes.Controls.Add(chkCompilar);
            opcoes.Controls.Add(chkAutoIniciar);

            log.Dock = DockStyle.Fill;
            log.ReadOnly = true;
            log.BorderStyle = BorderStyle.None;
            log.BackColor = Color.FromArgb(15, 23, 42);
            log.ForeColor = Color.FromArgb(226, 232, 240);
            log.Font = new Font("Consolas", 9.5f);
            log.WordWrap = true;
            log.DetectUrls = true;
            log.LinkClicked += delegate(object s, LinkClickedEventArgs e) { try { Process.Start(e.LinkText); } catch (Exception) { } };

            var menuLog = new ContextMenuStrip();
            menuLog.Items.Add("Copiar", null, delegate { if (log.SelectionLength > 0) log.Copy(); });
            menuLog.Items.Add("Limpar", null, delegate { log.Clear(); avisos = erros = 0; AtualizarInfo(); });
            menuLog.Items.Add("Abrir painel.log", null, delegate { if (File.Exists(arquivoLog)) Process.Start("notepad.exe", "\"" + arquivoLog + "\""); });
            log.ContextMenuStrip = menuLog;

            var separador = new Panel { Dock = DockStyle.Top, Height = 1, BackColor = Color.FromArgb(226, 232, 240) };

            // Ordem inversa: com Dock=Top, o último adicionado fica em cima.
            Controls.Add(log);
            Controls.Add(separador);
            Controls.Add(opcoes);
            Controls.Add(barra);
            Controls.Add(topo);
        }

        static void AdicionarLinha(TableLayoutPanel grade, string rotulo, Control valor)
        {
            var l = new Label { Text = rotulo, AutoSize = true, ForeColor = Color.FromArgb(100, 116, 139), Margin = new Padding(0, 1, 14, 1) };
            valor.AutoSize = true;
            valor.Margin = new Padding(0, 1, 0, 1);
            grade.Controls.Add(l);
            grade.Controls.Add(valor);
        }

        static void Botao(Button b, string texto, EventHandler acao)
        {
            b.Text = texto;
            b.AutoSize = true;
            b.Padding = new Padding(8, 2, 8, 2);
            b.Margin = new Padding(4);
            b.Click += acao;
        }

        void MontarBandeja()
        {
            bandeja.Icon = Icon ?? SystemIcons.Application;
            bandeja.Text = "Painel Sites Express";
            bandeja.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Mostrar o lançador", null, delegate { Mostrar(); });
            menu.Items.Add("Abrir o painel no navegador", null, delegate { AbrirNoNavegador(); });
            menuIniciarParar.Click += delegate
            {
                if (servidor != null || estado == Estado.Externo) Parar(false, false); else Iniciar();
            };
            menu.Items.Add(menuIniciarParar);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair (encerra o painel)", null, delegate { Sair(); });
            bandeja.ContextMenuStrip = menu;
            bandeja.DoubleClick += delegate { Mostrar(); };
            bandeja.BalloonTipClicked += delegate { Mostrar(); };
        }

        void Mostrar()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            // Minimizar esconde na bandeja: o painel continua no ar.
            if (WindowState == FormWindowState.Minimized && Visible)
            {
                Hide();
                bandeja.ShowBalloonTip(2500, "Painel Sites Express", "Continua rodando aqui na bandeja.", ToolTipIcon.Info);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && (servidor != null || tarefa != null))
            {
                var r = MessageBox.Show(
                    "O painel está rodando.\n\nSim — fechar e encerrar o painel.\nNão — esconder na bandeja e manter o painel no ar.",
                    "Fechar o lançador", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                if (r == DialogResult.Cancel) { e.Cancel = true; return; }
                if (r == DialogResult.No) { e.Cancel = true; Hide(); return; }
                e.Cancel = true;
                Sair();
                return;
            }
            // Logoff, desligamento ou fechamento pelo sistema: sem pergunta, mas sem deixar nada para trás.
            if (tarefa != null) MatarArvore(tarefa.Id);
            if (servidor != null) { paradaPedida = true; MatarArvore(servidor.Id); }
            bandeja.Visible = false;
            base.OnFormClosing(e);
        }

        void Sair()
        {
            if (servidor != null || tarefa != null)
            {
                sairDepoisDeParar = true;
                Parar(true, false);
                return;
            }
            bandeja.Visible = false;
            relogio.Stop();
            Application.Exit();
        }

        /* ---- Ciclo do servidor ----------------------------------------- */

        void RelerEnv()
        {
            var env = Projeto.LerEnv(raiz);
            string p;
            int n;
            porta = env.TryGetValue("PORT", out p) && int.TryParse(p, out n) && n > 0 && n < 65536 ? n : 3333;
            host = env.TryGetValue("SERVER_HOST", out p) ? p.Trim() : "";
        }

        /// <summary>Onde a sonda bate: o próprio IP se o painel estiver preso a um, senão o loopback.</summary>
        string HostDaSonda()
        {
            if (host == "" || host == "0.0.0.0" || host == "::" || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return "127.0.0.1";
            return host;
        }

        string UrlDoPainel()
        {
            string h = HostDaSonda() == "127.0.0.1" ? "localhost" : HostDaSonda();
            return "http://" + h + ":" + porta + "/";
        }

        void Iniciar()
        {
            if (servidor != null || tarefa != null) return;
            if (estado == Estado.Externo)
            {
                Registrar("Já há um painel no ar na porta " + porta + ". Use Parar para encerrá-lo antes de iniciar por aqui.", Tipo.Aviso);
                return;
            }
            RelerEnv();
            detalheFalha = "";
            string node = Projeto.AcharNode();
            if (node == null)
            {
                Falhar("Node.js não encontrado. Instale em nodejs.org (versão 22 ou mais nova) e abra o lançador de novo.");
                return;
            }
            MudarEstado(Estado.Preparando);

            // Dependências: sem elas a API nem carrega.
            if (!Directory.Exists(Path.Combine(raiz, "server", "node_modules")) ||
                !Directory.Exists(Path.Combine(raiz, "web", "node_modules")))
            {
                Registrar("Dependências ausentes — rodando npm run setup (só na primeira vez).", Tipo.Sistema);
                RodarNpm("run setup", delegate(int codigo)
                {
                    if (codigo != 0) { Falhar("npm run setup terminou com erro (código " + codigo + "). Veja o log."); return; }
                    Iniciar2(node);
                });
                return;
            }
            Iniciar2(node);
        }

        void Iniciar2(string node)
        {
            bool existe;
            bool desatualizada = Projeto.InterfaceDesatualizada(raiz, out existe);
            if (!existe || (desatualizada && prefs.CompilarAoIniciar))
            {
                Registrar(existe ? "A interface mudou desde a última compilação — compilando." : "Interface ainda não compilada — compilando.", Tipo.Sistema);
                RodarNpm("run build", delegate(int codigo)
                {
                    if (codigo != 0 && !File.Exists(Path.Combine(raiz, "web", "dist", "index.html")))
                    {
                        Falhar("A compilação da interface falhou (código " + codigo + "). Veja o log.");
                        return;
                    }
                    if (codigo != 0) Registrar("A compilação falhou; subindo com a interface compilada anterior.", Tipo.Aviso);
                    SubirServidor(node);
                });
                return;
            }
            if (desatualizada) Registrar("A interface compilada está mais velha que o código dela (compilação automática desligada).", Tipo.Aviso);
            SubirServidor(node);
        }

        void SubirServidor(string node)
        {
            var info = new ProcessStartInfo(node, "src/index.js")
            {
                WorkingDirectory = Path.Combine(raiz, "server"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            info.EnvironmentVariables["NO_COLOR"] = "1";
            info.EnvironmentVariables["FORCE_COLOR"] = "0";

            try
            {
                var p = new Process { StartInfo = info, EnableRaisingEvents = true };
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) RegistrarDeOutraThread(e.Data, Tipo.Saida); };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) RegistrarDeOutraThread(e.Data, Tipo.Erro); };
                p.Exited += delegate { BeginInvoke(new Action(delegate { ServidorSaiu(p); })); };
                paradaPedida = false;
                p.Start();
                Trabalho.Vincular(p);
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                servidor = p;
                inicio = DateTime.Now;
                Registrar("Painel iniciado (PID " + p.Id + ").", Tipo.Sistema);
                MudarEstado(Estado.Iniciando);
            }
            catch (Exception ex)
            {
                Falhar("Não consegui iniciar o Node: " + ex.Message);
            }
        }

        void ServidorSaiu(Process p)
        {
            if (p != servidor) return;
            int codigo = 0;
            try { codigo = p.ExitCode; } catch (Exception) { }
            servidor = null;
            p.Dispose();

            if (paradaPedida)
            {
                Registrar("Painel encerrado.", Tipo.Sistema);
                MudarEstado(Estado.Parado);
                DepoisDeParar();
                return;
            }
            Falhar("O painel parou sozinho (código " + codigo + "). As últimas linhas do log dizem o motivo.");
            if (!Visible) bandeja.ShowBalloonTip(5000, "O painel parou", "Clique para ver o log.", ToolTipIcon.Error);
        }

        void Parar(bool semPerguntar, bool paraReiniciar)
        {
            reiniciarDepoisDeParar = paraReiniciar;
            if (tarefa != null)
            {
                paradaPedida = true;
                MatarArvore(tarefa.Id);
                return;
            }
            if (servidor != null)
            {
                paradaPedida = true;
                MudarEstado(Estado.Parando);
                MatarArvore(servidor.Id);
                return;
            }
            if (estado == Estado.Externo)
            {
                int pid = Projeto.PidNaPorta(porta);
                if (pid == 0) { Registrar("Não achei o processo que ocupa a porta " + porta + ".", Tipo.Aviso); return; }
                string nome = "?";
                try { nome = Process.GetProcessById(pid).ProcessName; } catch (Exception) { }
                if (!semPerguntar && MessageBox.Show(
                        "Este painel foi iniciado fora do lançador (PID " + pid + ", " + nome + ").\n\nEncerrá-lo?",
                        "Parar o painel", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
                MatarArvore(pid);
                Registrar("Painel externo encerrado (PID " + pid + ").", Tipo.Sistema);
                MudarEstado(Estado.Parado);
                DepoisDeParar();
                return;
            }
            DepoisDeParar();
        }

        void DepoisDeParar()
        {
            if (sairDepoisDeParar) { sairDepoisDeParar = false; Sair(); return; }
            if (reiniciarDepoisDeParar)
            {
                reiniciarDepoisDeParar = false;
                // Dá um instante para a porta ser liberada.
                var t = new System.Windows.Forms.Timer { Interval = 800 };
                t.Tick += delegate { t.Stop(); t.Dispose(); Iniciar(); };
                t.Start();
            }
        }

        void Reiniciar()
        {
            if (servidor == null && estado != Estado.Externo) { Iniciar(); return; }
            Registrar("Reiniciando…", Tipo.Sistema);
            Parar(false, true);
        }

        static void MatarArvore(int pid)
        {
            try
            {
                var info = new ProcessStartInfo("taskkill.exe", "/PID " + pid + " /T /F") { UseShellExecute = false, CreateNoWindow = true };
                using (var p = Process.Start(info)) p.WaitForExit(10000);
            }
            catch (Exception) { }
        }

        void CompilarManual()
        {
            if (tarefa != null) return;
            bool estavaRodando = servidor != null;
            Registrar("Compilando a interface…", Tipo.Sistema);
            if (!estavaRodando) MudarEstado(Estado.Preparando);
            RodarNpm("run build", delegate(int codigo)
            {
                if (codigo == 0)
                    Registrar(estavaRodando ? "Interface compilada. Recarregue a página do painel no navegador." : "Interface compilada.", Tipo.Sistema);
                else
                    Registrar("A compilação falhou (código " + codigo + ").", Tipo.Erro);
                if (!estavaRodando) MudarEstado(Estado.Parado);
                AtualizarInfo();
            });
        }

        void RodarNpm(string argumentos, Action<int> aoTerminar)
        {
            var info = new ProcessStartInfo("cmd.exe", "/d /s /c \"npm " + argumentos + "\"")
            {
                WorkingDirectory = raiz,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            info.EnvironmentVariables["NO_COLOR"] = "1";
            info.EnvironmentVariables["FORCE_COLOR"] = "0";
            Registrar("> npm " + argumentos, Tipo.Sistema);
            try
            {
                var p = new Process { StartInfo = info, EnableRaisingEvents = true };
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) RegistrarDeOutraThread(e.Data, Tipo.Saida); };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) RegistrarDeOutraThread(e.Data, Tipo.Saida); };
                p.Exited += delegate
                {
                    BeginInvoke(new Action(delegate
                    {
                        int codigo = -1;
                        try { codigo = p.ExitCode; } catch (Exception) { }
                        p.Dispose();
                        tarefa = null;
                        if (paradaPedida)
                        {
                            paradaPedida = false;
                            Registrar("Tarefa interrompida.", Tipo.Aviso);
                            MudarEstado(Estado.Parado);
                            DepoisDeParar();
                            return;
                        }
                        aoTerminar(codigo);
                    }));
                };
                p.Start();
                Trabalho.Vincular(p);
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                tarefa = p;
                paradaPedida = false;
                AtualizarBotoes();
            }
            catch (Exception ex)
            {
                Falhar("Não consegui rodar o npm: " + ex.Message);
            }
        }

        void Falhar(string motivo)
        {
            detalheFalha = motivo;
            Registrar(motivo, Tipo.Erro);
            MudarEstado(Estado.Falhou);
        }

        /* ---- Verificação periódica ------------------------------------- */

        void Verificar()
        {
            AtualizarInfo();
            if (estado == Estado.Preparando || estado == Estado.Parando) return;
            Sondar(delegate(bool noAr)
            {
                if (servidor != null)
                {
                    if (noAr) MudarEstado(Estado.Rodando);
                    else if (estado == Estado.Rodando) MudarEstado(Estado.Iniciando); // parou de responder
                }
                else if (tarefa == null)
                {
                    if (noAr) MudarEstado(Estado.Externo);
                    else if (estado == Estado.Externo || estado == Estado.Rodando) MudarEstado(Estado.Parado);
                }
            });
        }

        /// <summary>Qualquer resposta HTTP (até 403/404) significa que a API está no ar.</summary>
        void Sondar(Action<bool> resultado)
        {
            if (Interlocked.Exchange(ref sondando, 1) == 1) return;
            string url = "http://" + HostDaSonda() + ":" + porta + "/api/__lancador";
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool noAr = false;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Timeout = 1500;
                    req.ReadWriteTimeout = 1500;
                    req.Proxy = null;
                    using (req.GetResponse()) noAr = true;
                }
                catch (WebException ex) { noAr = ex.Response != null; if (ex.Response != null) ex.Response.Close(); }
                catch (Exception) { }
                Interlocked.Exchange(ref sondando, 0);
                try { BeginInvoke(new Action(delegate { resultado(noAr); })); } catch (InvalidOperationException) { }
            });
        }

        /* ---- Estado na tela -------------------------------------------- */

        Color CorDoEstado()
        {
            switch (estado)
            {
                case Estado.Rodando: return Color.FromArgb(22, 163, 74);
                case Estado.Externo: return Color.FromArgb(37, 99, 235);
                case Estado.Iniciando:
                case Estado.Preparando:
                case Estado.Parando: return Color.FromArgb(234, 179, 8);
                case Estado.Falhou: return Color.FromArgb(220, 38, 38);
                default: return Color.FromArgb(148, 163, 184);
            }
        }

        void MudarEstado(Estado novo)
        {
            if (novo == Estado.Rodando && estado != Estado.Rodando)
            {
                Registrar("Painel no ar em " + UrlDoPainel(), Tipo.Sistema);
            }
            estado = novo;
            AtualizarInfo();
            AtualizarBotoes();
            indicador.Invalidate();
        }

        void AtualizarInfo()
        {
            string titulo, detalhe;
            switch (estado)
            {
                case Estado.Rodando:
                    titulo = "No ar";
                    detalhe = "PID " + (servidor != null ? servidor.Id.ToString() : "?") + " · iniciado " + Decorrido(inicio);
                    break;
                case Estado.Iniciando:
                    titulo = "Iniciando…";
                    detalhe = "Aguardando a API responder na porta " + porta + " (" + (int)(DateTime.Now - inicio).TotalSeconds + " s)";
                    break;
                case Estado.Preparando:
                    titulo = "Preparando…";
                    detalhe = "Instalando dependências ou compilando a interface — acompanhe o log";
                    break;
                case Estado.Parando: titulo = "Parando…"; detalhe = ""; break;
                case Estado.Externo:
                    titulo = "No ar (fora do lançador)";
                    detalhe = "Outro processo já serve o painel na porta " + porta + ". Parar o encerra; depois, Iniciar sobe por aqui.";
                    break;
                case Estado.Falhou: titulo = "Falhou"; detalhe = detalheFalha; break;
                default: titulo = "Parado"; detalhe = "Clique em Iniciar para subir o painel."; break;
            }
            lblEstado.Text = titulo;
            lblEstado.ForeColor = estado == Estado.Falhou ? Color.FromArgb(185, 28, 28) : Color.FromArgb(15, 23, 42);
            lblDetalhe.Text = detalhe;
            lnkEndereco.Text = UrlDoPainel();

            bool rede = host == "0.0.0.0" || host == "::";
            if (rede)
            {
                var ips = Projeto.EnderecosDaRede();
                lblRede.Text = ips.Count == 0 ? "aberto para a rede (sem IP privado detectado)"
                    : string.Join("  ·  ", ips.ConvertAll(delegate(string ip) { return "http://" + ip + ":" + porta; }).ToArray());
            }
            else lblRede.Text = host == "" || HostDaSonda() == "127.0.0.1" ? "só esta máquina" : "preso a " + host;

            bool existe;
            bool velha = Projeto.InterfaceDesatualizada(raiz, out existe);
            if (!existe) { lblInterface.Text = "não compilada"; lblInterface.ForeColor = Color.FromArgb(185, 28, 28); }
            else if (velha) { lblInterface.Text = "desatualizada — o código mudou desde a última compilação"; lblInterface.ForeColor = Color.FromArgb(180, 83, 9); }
            else { lblInterface.Text = "compilada e em dia"; lblInterface.ForeColor = Color.FromArgb(21, 128, 61); }

            if (lblNode.Tag == null)
            {
                string node = Projeto.AcharNode();
                lblNode.Text = node ?? "não encontrado — instale o Node.js 22+";
                lblNode.ForeColor = node == null ? Color.FromArgb(185, 28, 28) : lblDetalhe.ForeColor;
                lblNode.Tag = node == null ? null : "ok";
            }

            lblContagem.Text = erros + " erro(s) · " + avisos + " aviso(s) desde a abertura  —  gravado em painel.log";

            string curto = titulo.Length > 40 ? titulo.Substring(0, 40) : titulo;
            bandeja.Text = ("Painel Sites Express — " + curto).Length > 63 ? "Painel — " + curto : "Painel Sites Express — " + curto;
            Text = "Painel Sites Express — " + titulo;
        }

        void AtualizarBotoes()
        {
            bool ocupado = tarefa != null || estado == Estado.Parando;
            bool rodando = servidor != null;
            btnIniciar.Enabled = !rodando && !ocupado && estado != Estado.Externo;
            btnParar.Enabled = rodando || estado == Estado.Externo || tarefa != null;
            btnReiniciar.Enabled = (rodando || estado == Estado.Externo) && !ocupado;
            btnAbrir.Enabled = estado == Estado.Rodando || estado == Estado.Externo;
            btnCompilar.Enabled = tarefa == null;
            menuIniciarParar.Text = rodando || estado == Estado.Externo ? "Parar o painel" : "Iniciar o painel";
            menuIniciarParar.Enabled = !ocupado || tarefa != null;
        }

        static string Decorrido(DateTime desde)
        {
            var d = DateTime.Now - desde;
            if (d.TotalMinutes < 1) return "agora há pouco";
            if (d.TotalHours < 1) return "há " + (int)d.TotalMinutes + " min";
            if (d.TotalDays < 1) return "há " + (int)d.TotalHours + " h " + d.Minutes + " min";
            return "há " + (int)d.TotalDays + " dia(s)";
        }

        void AbrirNoNavegador()
        {
            try { Process.Start(UrlDoPainel()); } catch (Exception ex) { Registrar("Não consegui abrir o navegador: " + ex.Message, Tipo.Erro); }
        }

        /* ---- Log -------------------------------------------------------- */

        enum Tipo { Saida, Erro, Aviso, Sistema }

        static readonly Regex Ansi = new Regex(@"\x1B\[[0-9;]*[A-Za-z]");

        void RegistrarDeOutraThread(string linha, Tipo tipo)
        {
            try { BeginInvoke(new Action(delegate { Registrar(linha, tipo); })); } catch (InvalidOperationException) { }
        }

        void Registrar(string texto, Tipo tipo)
        {
            texto = Ansi.Replace(texto, "");
            // O Node escreve avisos no stderr também; só conta como erro o que parece erro.
            if (tipo == Tipo.Erro && !Regex.IsMatch(texto, @"(?i)erro|error|falh|fail|exception|EADDRINUSE|não")) tipo = Tipo.Aviso;
            if (tipo == Tipo.Saida && Regex.IsMatch(texto, @"(?i)^\s*(aviso|warn|\[warn)")) tipo = Tipo.Aviso;
            if (tipo == Tipo.Erro) erros++;
            if (tipo == Tipo.Aviso) avisos++;

            string linha = DateTime.Now.ToString("HH:mm:ss") + "  " + texto;
            Color cor;
            switch (tipo)
            {
                case Tipo.Erro: cor = Color.FromArgb(248, 113, 113); break;
                case Tipo.Aviso: cor = Color.FromArgb(251, 191, 36); break;
                case Tipo.Sistema: cor = Color.FromArgb(125, 211, 252); break;
                default: cor = Color.FromArgb(226, 232, 240); break;
            }

            bool noFim = log.SelectionStart >= log.TextLength - 1 || log.SelectionLength == 0;
            log.SelectionStart = log.TextLength;
            log.SelectionLength = 0;
            log.SelectionColor = cor;
            log.AppendText(linha + Environment.NewLine);
            if (log.Lines.Length > MaxLinhasLog)
            {
                log.Select(0, log.GetFirstCharIndexFromLine(log.Lines.Length - MaxLinhasLog));
                log.ReadOnly = false;
                log.SelectedText = "";
                log.ReadOnly = true;
            }
            if (noFim) { log.SelectionStart = log.TextLength; log.ScrollToCaret(); }

            GravarNoArquivo(DateTime.Now.ToString("yyyy-MM-dd ") + linha);
        }

        void GravarNoArquivo(string linha)
        {
            try
            {
                var fi = new FileInfo(arquivoLog);
                if (fi.Exists && fi.Length > MaxBytesArquivoLog)
                {
                    string antigo = arquivoLog + ".1";
                    if (File.Exists(antigo)) File.Delete(antigo);
                    File.Move(arquivoLog, antigo);
                }
                File.AppendAllText(arquivoLog, linha + Environment.NewLine, new UTF8Encoding(false));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>As duas caixinhas da janela, lembradas entre aberturas.</summary>
    class Preferencias
    {
        public bool CompilarAoIniciar = true;
        public bool AutoIniciar = true;

        static string Arquivo()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PainelSitesExpress", "lancador.ini");
        }

        public static Preferencias Carregar()
        {
            var p = new Preferencias();
            try
            {
                if (!File.Exists(Arquivo())) return p;
                foreach (var linha in File.ReadAllLines(Arquivo()))
                {
                    var partes = linha.Split(new[] { '=' }, 2);
                    if (partes.Length != 2) continue;
                    bool v = partes[1].Trim() == "1";
                    if (partes[0] == "compilar") p.CompilarAoIniciar = v;
                    if (partes[0] == "autoiniciar") p.AutoIniciar = v;
                }
            }
            catch (Exception) { }
            return p;
        }

        public void Salvar()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Arquivo()));
                File.WriteAllText(Arquivo(), "compilar=" + (CompilarAoIniciar ? "1" : "0") + "\r\nautoiniciar=" + (AutoIniciar ? "1" : "0") + "\r\n");
            }
            catch (Exception) { }
        }
    }
}
