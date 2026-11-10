using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class LaunchResult
{
    internal string Url;
    internal string InstallDirectory;
    internal bool ReusedExisting;
    internal bool Ready;
    internal Process Backend;
}

internal static class Program
{
    private const string HelperName = "BotDrafts Screen Helper";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [STAThread]
    private static void Main(string[] args)
    {
        bool test = args.Length > 0 && args[0] == "--self-test";
        string report = test && args.Length > 1 ? Path.GetFullPath(args[1]) : null;
        if (test)
        {
            LaunchResult result = null;
            try
            {
                result = Launch(delegate(int percent, string status) { }, true);
                if (!result.Ready || result.ReusedExisting) throw new Exception("The packaged reader did not complete a fresh startup.");
                WriteReport(report, new { ok = true, version = BuildInfo.Version, url = result.Url, ready = result.Ready, reusedExisting = result.ReusedExisting });
                Environment.ExitCode = 0;
            }
            catch (Exception error)
            {
                WriteReport(report, new { ok = false, error = error.Message });
                Environment.ExitCode = 1;
            }
            finally
            {
                if (result != null && !result.ReusedExisting)
                {
                    try { Request(result.Url + "helper/stop", "POST"); } catch { }
                    if (result.Backend != null)
                    {
                        try { result.Backend.WaitForExit(5000); } catch { }
                        result.Backend.Dispose();
                    }
                }
            }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LaunchWindow());
    }

    private static void WriteReport(string path, object value)
    {
        if (path == null) return;
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, Json.Serialize(value));
    }

    internal static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    internal static void StopBackend(string url)
    {
        Request(url + "helper/stop", "POST");
    }

    private static string Request(string url, string method)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null;
        request.Method = method;
        request.Timeout = 1000;
        request.ReadWriteTimeout = 1000;
        if (method == "POST")
        {
            request.ContentType = "application/json";
            byte[] body = System.Text.Encoding.UTF8.GetBytes("{}");
            request.ContentLength = body.Length;
            using (Stream output = request.GetRequestStream()) output.Write(body, 0, body.Length);
        }
        using (WebResponse response = request.GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
    }

    private static bool Health(string url, out bool ready)
    {
        ready = false;
        try
        {
            Dictionary<string, object> value = Json.Deserialize<Dictionary<string, object>>(Request(url + "helper/health", "GET"));
            if (!value.ContainsKey("name") || (string)value["name"] != HelperName) return false;
            ready = value.ContainsKey("ready") && Convert.ToBoolean(value["ready"]);
            return true;
        }
        catch { return false; }
    }

    internal static LaunchResult Launch(Action<int, string> progress, bool test)
    {
        int port;
        string configured = Environment.GetEnvironmentVariable("BOTDRAFTS_PORT");
        if (!Int32.TryParse(configured, out port)) port = test ? 18766 : 8766;
        if (port < 1 || port > 65535) throw new Exception("Choose a valid BOTDRAFTS_PORT between 1 and 65535.");
        string url = "http://127.0.0.1:" + port + "/";
        bool ready;
        if (Health(url, out ready)) return new LaunchResult { Url = url, Ready = ready, ReusedExisting = true };

        progress(5, "Preparing BotDrafts…");
        string install = Install(progress);
        string app = Path.Combine(install, "app");
        string node = Path.Combine(install, "runtime", "node.exe");
        string log = Path.Combine(install, "last-run.log");
        progress(85, "Starting the draft reader…");
        ProcessStartInfo start = new ProcessStartInfo(node, "\"" + Path.Combine(app, "server.mjs") + "\"");
        start.WorkingDirectory = app;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.EnvironmentVariables["BOTDRAFTS_PORT"] = port.ToString();
        start.EnvironmentVariables.Remove("NODE_OPTIONS");
        start.EnvironmentVariables.Remove("NODE_PATH");
        Process backend = new Process { StartInfo = start, EnableRaisingEvents = true };
        object logLock = new object();
        File.WriteAllText(log, "BotDrafts Helper " + BuildInfo.Version + Environment.NewLine);
        DataReceivedEventHandler logging = delegate(object sender, DataReceivedEventArgs entry)
        {
            if (entry.Data == null) return;
            try { lock (logLock) { File.AppendAllText(log, entry.Data + Environment.NewLine); } } catch { }
        };
        backend.OutputDataReceived += logging;
        backend.ErrorDataReceived += logging;
        if (!backend.Start()) throw new Exception("The bundled reader could not start.");
        backend.BeginOutputReadLine();
        backend.BeginErrorReadLine();
        bool found = false;
        Stopwatch wait = Stopwatch.StartNew();
        while (wait.ElapsedMilliseconds < 30000)
        {
            found = Health(url, out ready);
            if (found && ready) return new LaunchResult { Url = url, Ready = true, InstallDirectory = install, Backend = backend };
            if (backend.HasExited) throw new Exception("BotDrafts could not start. Details are in " + log);
            if (found && !test && wait.ElapsedMilliseconds > 8000) return new LaunchResult { Url = url, Ready = false, InstallDirectory = install, Backend = backend };
            Thread.Sleep(200);
        }
        if (found && !test) return new LaunchResult { Url = url, Ready = false, InstallDirectory = install, Backend = backend };
        throw new Exception("The reader did not finish starting. Details are in " + log);
    }

    private static string Install(Action<int, string> progress)
    {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BotDraftsHelper", "versions");
        string destination = Path.Combine(root, BuildInfo.Version + "-" + BuildInfo.PayloadHash.Substring(0, 12));
        string marker = Path.Combine(destination, ".complete");
        Directory.CreateDirectory(root);
        using (Mutex installLock = new Mutex(false, "Local\\BotDraftsHelper-Install"))
        {
            bool owned = false;
            try
            {
                try { owned = installLock.WaitOne(60000); } catch (AbandonedMutexException) { owned = true; }
                if (!owned) throw new Exception("Another copy is preparing BotDrafts. Try again in a moment.");
                if (File.Exists(marker) && File.ReadAllText(marker) == BuildInfo.PayloadHash && File.Exists(Path.Combine(destination, "runtime", "node.exe"))) return destination;
                if (Directory.Exists(destination)) destination += "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
                marker = Path.Combine(destination, ".complete");
                string staging = Path.Combine(root, "preparing-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                string prefix = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
                using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("BotDrafts.Payload.zip"))
                {
                    if (payload == null) throw new Exception("The application package is missing.");
                    using (SHA256 checksum = SHA256.Create())
                    {
                        string actual = BitConverter.ToString(checksum.ComputeHash(payload)).Replace("-", "").ToLowerInvariant();
                        if (actual != BuildInfo.PayloadHash) throw new Exception("This application file is incomplete. Download it again.");
                    }
                    payload.Position = 0;
                    using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, true))
                    {
                        long total = 0, completed = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries) total += entry.Length;
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string target = Path.GetFullPath(Path.Combine(staging, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new Exception("The package contains an invalid file path.");
                            if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(target));
                            using (Stream input = entry.Open())
                            using (FileStream output = File.Create(target)) input.CopyTo(output);
                            completed += entry.Length;
                            progress(10 + (int)(70 * completed / Math.Max(total, 1)), "Setting up BotDrafts for the first time…");
                        }
                    }
                }
                File.WriteAllText(Path.Combine(staging, ".complete"), BuildInfo.PayloadHash);
                Directory.Move(staging, destination);
                return destination;
            }
            finally { if (owned) installLock.ReleaseMutex(); }
        }
    }
}

internal sealed class LaunchWindow : Form
{
    private readonly Label status;
    private readonly ProgressBar progress;
    private readonly BackgroundWorker worker;
    private NotifyIcon tray;
    private LaunchResult active;

    internal LaunchWindow()
    {
        Text = "BotDrafts Helper";
        ClientSize = new Size(440, 175);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = Color.FromArgb(16, 26, 48);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Controls.Add(new Label { Text = "BotDrafts Helper", Font = new Font("Segoe UI", 19, FontStyle.Bold), Location = new Point(24, 20), AutoSize = true });
        status = new Label { Text = "Opening your draft reader…", Location = new Point(26, 76), Size = new Size(390, 35) };
        progress = new ProgressBar { Location = new Point(26, 122), Size = new Size(388, 14), Style = ProgressBarStyle.Continuous };
        Controls.Add(status); Controls.Add(progress);
        worker = new BackgroundWorker { WorkerReportsProgress = true };
        worker.DoWork += delegate(object sender, DoWorkEventArgs args)
        {
            args.Result = Program.Launch(delegate(int value, string message) { worker.ReportProgress(value, message); }, false);
        };
        worker.ProgressChanged += delegate(object sender, ProgressChangedEventArgs args) { progress.Value = Math.Max(0, Math.Min(100, args.ProgressPercentage)); status.Text = (string)args.UserState; };
        worker.RunWorkerCompleted += delegate(object sender, RunWorkerCompletedEventArgs args)
        {
            if (args.Error != null) MessageBox.Show(this, args.Error.Message, "BotDrafts Helper", MessageBoxButtons.OK, MessageBoxIcon.Information);
            else
            {
                LaunchResult result = (LaunchResult)args.Result;
                try { Program.OpenBrowser(result.Url + "#draft"); }
                catch { MessageBox.Show(this, "Open " + result.Url + " in your browser.", "BotDrafts Helper"); }
                if (!result.ReusedExisting && result.Backend != null)
                {
                    active = result;
                    ContextMenuStrip menu = new ContextMenuStrip();
                    menu.Items.Add("Open BotDrafts", null, delegate { Program.OpenBrowser(active.Url + "#draft"); });
                    menu.Items.Add("Quit", null, delegate
                    {
                        try { Program.StopBackend(active.Url); } catch { }
                        try { if (!active.Backend.WaitForExit(3000)) active.Backend.Kill(); } catch { }
                        Close();
                    });
                    tray = new NotifyIcon { Text = "BotDrafts Helper", Icon = Icon, ContextMenuStrip = menu, Visible = true };
                    tray.DoubleClick += delegate { Program.OpenBrowser(active.Url + "#draft"); };
                    active.Backend.Exited += delegate
                    {
                        try { if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(delegate { Close(); })); } catch { }
                    };
                    Hide();
                    if (active.Backend.HasExited) Close();
                    return;
                }
            }
            Close();
        };
        Shown += delegate { worker.RunWorkerAsync(); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) { if (worker.IsBusy) args.Cancel = true; };
        FormClosed += delegate { if (tray != null) tray.Dispose(); if (active != null && active.Backend != null) active.Backend.Dispose(); };
    }
}
