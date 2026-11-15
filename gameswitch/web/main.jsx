import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Cpu,
  Database,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MemoryStick,
  MoreHorizontal,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

let csrfToken = "";

async function api(path, options = {}) {
  const method = options.method || "GET";
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || `Die Anfrage ist fehlgeschlagen (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

const navItems = [
  ["overview", LayoutDashboard, "Übersicht"],
  ["profiles", Layers3, "Spielprofile"],
  ["backups", Database, "Backups"],
  ["activity", Activity, "Aktivität"],
];
const gameName = (id) =>
  id === "minecraft"
    ? "Minecraft"
    : id === "gmod" || id === "garrysmod"
      ? "Garry’s Mod"
      : id;
const isMinecraft = (profile) => profile?.gameId === "minecraft";
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "–";
const ram = (mb) => `${Number(mb || 0) / 1024} GB`;
const loaderName = (value) =>
  ({
    vanilla: "Vanilla",
    paper: "Paper",
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    modrinth: "Modrinth",
    ftb: "Feed the Beast",
    steam: "SteamCMD",
    default: "Standard",
  })[value] ||
  value ||
  "Standard";

function Mark({ small = false }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function GameArt({ game = "minecraft", compact = false }) {
  const minecraft = game === "minecraft";
  return (
    <div
      className={`game-art ${minecraft ? "art-minecraft" : "art-gmod"} ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <div className="art-grid" />
      {minecraft ? (
        <>
          <div className="voxel v-one" />
          <div className="voxel v-two" />
          <div className="voxel v-three" />
          <div className="voxel v-four" />
          <div className="art-sun" />
        </>
      ) : (
        <>
          <span className="gmod-letter">g</span>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-cross">+</div>
        </>
      )}
      <div className="art-caption">
        <span>
          {minecraft ? "BUILD SOMETHING GREAT" : "YOUR SANDBOX. YOUR RULES."}
        </span>
        <strong>{minecraft ? "MINECRAFT" : "GARRY’S MOD"}</strong>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [consoleProfile, setConsoleProfile] = useState(null);
  const [consoleLines, setConsoleLines] = useState([]);
  const refresh = async () => {
    try {
      setState(await api("/state"));
    } catch (e) {
      if (e.status === 401) {
        csrfToken = "";
        setSession({ authenticated: false });
      } else setError(e.message);
    }
  };
  useEffect(() => {
    api("/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (session?.authenticated) refresh();
  }, [session?.authenticated]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const id = setInterval(
      refresh,
      state?.job?.status === "running" ? 2000 : 8000,
    );
    return () => clearInterval(id);
  }, [session?.authenticated, state?.job?.status]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const profiles = state?.profiles || [];
  const active =
    profiles.find((p) => p.id === state?.activeProfileId) ||
    profiles.find((p) => p.status === "running");
  const runningJob = state?.job?.status === "running";
  const sandbox = (state?.mode || session?.mode) === "sandbox";
  const mutate = async (path, success) => {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: {} });
      setModal(null);
      if (success) setNotice(success);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const showConsole = async (profile) => {
    setConsoleProfile(profile);
    setConsoleLines([]);
    try {
      const result = await api(
        `/profiles/${encodeURIComponent(profile.id)}/console`,
      );
      setConsoleLines(result.lines || []);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (!consoleProfile) return;
    const timer = setInterval(
      () =>
        api(`/profiles/${encodeURIComponent(consoleProfile.id)}/console`)
          .then((d) => setConsoleLines(d.lines || []))
          .catch(() => {}),
      4000,
    );
    return () => clearInterval(timer);
  }, [consoleProfile?.id]);

  if (!session)
    return (
      <div className="loading-screen">
        <Mark />
        <LoaderCircle className="spin" size={22} />
        <p>{error || "GameSwitch wird geladen …"}</p>
      </div>
    );
  if (!session.authenticated)
    return (
      <Auth
        session={session}
        onAuthenticated={(s) => {
          setSession(s);
          setError("");
        }}
      />
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="GameSwitch – Übersicht"
          onClick={(e) => {
            e.preventDefault();
            setTab("overview");
          }}
        >
          <Mark />
          <span>
            Game<span className="brand-light">Switch</span>
            <small>DEIN SERVER. DEINE SPIELE.</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">L</span>
          <div>
            <strong>Mein Gameserver</strong>
            <span>Persönlicher Workspace</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Hauptnavigation">
          {navItems.map(([id, Icon, title]) => (
            <button
              key={id}
              aria-label={title}
              title={title}
              className={`nav-item ${tab === id ? "selected" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              <span>{title}</span>
              {id === "profiles" && <small>{profiles.length}</small>}
            </button>
          ))}
        </nav>
        <span className="nav-label tools-label">VERWALTUNG</span>
        <button
          aria-label="Sicherheit &amp; System"
          title="Sicherheit &amp; System"
          className={`nav-item ${tab === "security" ? "selected" : ""}`}
          onClick={() => setTab("security")}
        >
          <ShieldCheck size={19} />
          <span>Sicherheit & System</span>
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={21} />
            <strong>Deine Welten bleiben.</strong>
            <p>
              Eigene Spielstände für jedes Profil. Sicher wechseln, später
              weiterspielen.
            </p>
          </div>
          <button
            className="user-button"
            aria-label="Abmelden"
            title="Abmelden"
            onClick={async () => {
              try {
                await api("/logout", { method: "POST", body: {} });
                csrfToken = "";
                setSession({ authenticated: false, mode: session.mode });
                setState(null);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <span className="user-avatar">
              {(session.username || "A").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{session.username || "Administrator"}</strong>
              <small>Administrator</small>
            </span>
            <LogOut size={16} aria-label="Abmelden" />
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>
              {
                {
                  overview: "Übersicht",
                  profiles: "Spielprofile",
                  backups: "Backups",
                  activity: "Aktivität",
                  security: "Sicherheit & System",
                }[tab]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`mode-pill ${sandbox ? "sandbox" : ""}`}>
              <span className="status-dot" />
              {sandbox ? "Sandbox · lokal" : "PufferPanel-Modus"}
            </span>
            <span className="topbar-divider" />
            <ShieldCheck size={18} className="muted" />
            <span className="topbar-avatar">
              {(session.username || "A").slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert alert-error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                aria-label="Fehlermeldung schließen"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success" role="status">
              <CheckCheck size={18} />
              <span>{notice}</span>
              <button
                aria-label="Meldung schließen"
                onClick={() => setNotice("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                DEIN GAME SERVER HUB
              </div>
              <h1>
                {
                  {
                    overview: "Deine nächste Session beginnt hier.",
                    profiles: "Ein Server. Viele Möglichkeiten.",
                    backups: "Fortschritt, der bleibt.",
                    activity: "Alles im Blick.",
                    security: "Sicherheit ist eingebaut.",
                  }[tab]
                }
              </h1>
              <p>
                {
                  {
                    overview:
                      "Spiele wechseln. Welten behalten. Alles an einem Ort.",
                    profiles:
                      "Verwalte deine Spiele, Versionen und Modpacks als eigene Profile.",
                    backups:
                      "Gesicherte Spielstände und Konfigurationen deiner Profile.",
                    activity: "Vorgänge und Änderungen in deinem Workspace.",
                    security:
                      "Zugriff, Laufzeitumgebung und Schutz deiner Spielstände.",
                  }[tab]
                }
              </p>
            </div>
            {(tab === "overview" || tab === "profiles") && (
              <button
                className="button primary"
                onClick={() => setModal({ type: "create" })}
                disabled={!state || runningJob}
              >
                <Plus size={18} />
                Neues Spielprofil
              </button>
            )}
          </div>

          {sandbox && (
            <div className="sandbox-banner">
              <Box size={18} />
              <span>
                <strong>Du bist in der lokalen Sandbox.</strong> Profile und
                Abläufe kannst du hier testen. Echte Gameserver starten nach der
                PufferPanel-Anbindung.
              </span>
              <button onClick={() => setTab("security")}>
                Details <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!state ? (
            <div className="empty-state loading-state">
              <LoaderCircle className="spin" />
              <h3>Workspace wird geladen</h3>
              <p>Der Serverstatus wird abgerufen.</p>
            </div>
          ) : (
            <>
              {(tab === "overview" || tab === "profiles") && (
                <>
                  {tab === "overview" && (
                    <div className="dashboard-grid">
                      <section className="active-panel panel">
                        <div className="section-top">
                          <span className="section-kicker">
                            <Radio size={15} />
                            AKTIVE SESSION
                          </span>
                          <span
                            className={`live-label ${active?.status === "running" ? "" : "inactive"}`}
                          >
                            <span className="status-dot" />
                            {active?.status === "running"
                              ? sandbox
                                ? "Simuliert aktiv"
                                : "Online"
                              : "Bereit zum Starten"}
                          </span>
                        </div>
                        <div className="active-content">
                          <div
                            className={`active-icon ${active && !isMinecraft(active) ? "blue" : ""}`}
                          >
                            {active && !isMinecraft(active) ? (
                              <span>g</span>
                            ) : (
                              <Box size={35} strokeWidth={1.5} />
                            )}
                          </div>
                          <div>
                            <span className="subtle-tag">
                              {active
                                ? gameName(active.gameId)
                                : "DEIN PLATZ FÜR DIE NÄCHSTE SESSION"}
                            </span>
                            <h2>
                              {active?.name || "Welches Spiel wird’s heute?"}
                            </h2>
                            <p>
                              {active
                                ? `${loaderName(active.loader)} · ${active.version || "Steam"} · ${ram(active.memoryMb)} RAM`
                                : "Erstelle ein Spielprofil und lade deine Freunde ein."}
                            </p>
                          </div>
                        </div>
                        <div className="active-footer">
                          {active ? (
                            <>
                              <div className="connection">
                                <span>SERVERPORT</span>
                                <strong>
                                  {active.port}{" "}
                                  <span>· {active.maxPlayers} Slots</span>
                                </strong>
                              </div>
                              <button
                                className="button subtle"
                                onClick={() => showConsole(active)}
                              >
                                <Terminal size={16} />
                                Konsole
                              </button>
                              <button
                                className="button danger-outline"
                                disabled={busy || runningJob}
                                onClick={() =>
                                  setModal({ type: "stop", profile: active })
                                }
                              >
                                <Square size={13} fill="currentColor" />
                                Stoppen
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="saved-note">
                                <ShieldCheck size={16} />
                                Getrennte Welten. Automatische Backups beim
                                Wechsel.
                              </span>
                              <button
                                className="button subtle"
                                disabled={runningJob}
                                onClick={() => setModal({ type: "create" })}
                              >
                                Profil erstellen <ArrowRight size={16} />
                              </button>
                            </>
                          )}
                        </div>
                        <div className="active-glow" />
                      </section>
                      <section className="node-panel panel">
                        <div className="section-top">
                          <span className="section-kicker">
                            <Server size={15} />
                            DEIN NODE
                          </span>
                          <span className="node-provider">NETCUP VPS</span>
                        </div>
                        <h3>{state.host?.name || "GameSwitch Node"}</h3>
                        <p className="node-note">
                          {sandbox
                            ? "Geplante VPS-Konfiguration"
                            : "Konfiguriertes Ressourcenbudget"}
                        </p>
                        <div className="hardware-row">
                          <span>
                            <Cpu size={17} />
                            CPU-Kerne
                          </span>
                          <strong>{state.host?.cpuCores || 8} vCPU</strong>
                        </div>
                        <div className="hardware-row">
                          <span>
                            <MemoryStick size={17} />
                            Arbeitsspeicher
                          </span>
                          <strong>{ram(state.host?.memoryMb || 16384)}</strong>
                        </div>
                        <div className="budget">
                          <div>
                            <span>Für Spielprofile verfügbar</span>
                            <strong>
                              {ram(
                                (state.host?.memoryMb || 16384) -
                                  (state.host?.reservedMemoryMb || 3072),
                              )}
                            </strong>
                          </div>
                          <div className="budget-bar">
                            <span />
                          </div>
                          <p>
                            {ram(state.host?.reservedMemoryMb || 3072)} Reserve
                            für System & Panel
                          </p>
                        </div>
                      </section>
                    </div>
                  )}
                  {state.job && (
                    <JobProgress job={state.job} profiles={profiles} />
                  )}
                  <section className="profiles-section">
                    <div className="section-title">
                      <div>
                        <h2>
                          Deine Spielprofile{" "}
                          <span className="count-badge">{profiles.length}</span>
                        </h2>
                        <p>
                          Ein Klick zum Wechseln. Dein Fortschritt zieht mit.
                        </p>
                      </div>
                      <label className="search-box">
                        <Search size={16} />
                        <input
                          aria-label="Spielprofile durchsuchen"
                          placeholder="Profile durchsuchen …"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <kbd>⌕</kbd>
                      </label>
                    </div>
                    <div className="profiles-grid">
                      {profiles
                        .filter((p) =>
                          `${p.name} ${gameName(p.gameId)} ${p.loader}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((profile) => (
                          <ProfileCard
                            key={profile.id}
                            profile={profile}
                            active={
                              active?.id === profile.id &&
                              profile.status === "running"
                            }
                            sandbox={sandbox}
                            disabled={busy || runningJob}
                            onActivate={() =>
                              setModal({ type: "activate", profile })
                            }
                            onConsole={() => showConsole(profile)}
                            onBackup={() =>
                              setModal({ type: "backup", profile })
                            }
                          />
                        ))}
                      <button
                        className="add-profile-card"
                        onClick={() => setModal({ type: "create" })}
                        disabled={runningJob}
                      >
                        <span className="add-icon">
                          <Plus size={23} />
                        </span>
                        <strong>Dein nächstes Abenteuer</strong>
                        <span>
                          Minecraft, Garry’s Mod und mehr.
                          <br />
                          Starte mit einem neuen Spielprofil.
                        </span>
                        <span className="add-link">
                          Spielprofil hinzufügen <ArrowRight size={15} />
                        </span>
                      </button>
                    </div>
                    {query &&
                      !profiles.some((p) =>
                        `${p.name} ${gameName(p.gameId)} ${p.loader}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      ) && (
                        <p className="no-results">
                          Keine passenden Profile gefunden.
                        </p>
                      )}
                  </section>
                  {tab === "overview" && (
                    <div className="bottom-grid">
                      <section className="panel quickstart-panel">
                        <div className="section-top">
                          <span className="section-kicker">
                            <Sparkles size={15} />
                            SCHNELLSTART
                          </span>
                          <span className="tag">SPIELEBIBLIOTHEK</span>
                        </div>
                        <h3>Was spielen wir als Nächstes?</h3>
                        <div className="quickstart-options">
                          {(state.catalog || []).map((game) => (
                            <button
                              key={game.id}
                              disabled={runningJob}
                              onClick={() =>
                                setModal({ type: "create", gameId: game.id })
                              }
                            >
                              <span
                                className={`game-mini ${game.id === "minecraft" ? "green" : "blue"}`}
                              >
                                {game.id === "minecraft" ? (
                                  <Box size={21} />
                                ) : (
                                  <span>g</span>
                                )}
                              </span>
                              <span>
                                <strong>{game.name}</strong>
                                <small>
                                  {game.id === "minecraft"
                                    ? "Vanilla, Modrinth & Feed the Beast"
                                    : "Workshop-Collections & Maps"}
                                </small>
                              </span>
                              <ArrowRight size={17} />
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="panel recent-panel">
                        <div className="section-top">
                          <span className="section-kicker">
                            <Activity size={15} />
                            LETZTE AKTIVITÄTEN
                          </span>
                          <button
                            className="text-button"
                            onClick={() => setTab("activity")}
                          >
                            Alle ansehen <ArrowRight size={14} />
                          </button>
                        </div>
                        <EventList
                          events={(state.events || []).slice(0, 3)}
                          compact
                        />
                      </section>
                    </div>
                  )}
                </>
              )}
              {tab === "backups" && (
                <Backups
                  state={state}
                  busy={busy || runningJob}
                  onRestore={(backup) => setModal({ type: "restore", backup })}
                  onNew={() => setTab("profiles")}
                />
              )}
              {tab === "activity" && (
                <section className="panel activity-panel">
                  <div className="section-top">
                    <h2>Protokoll</h2>
                    <span className="tag">
                      {state.events?.length || 0} EINTRÄGE
                    </span>
                  </div>
                  <EventList events={state.events || []} />
                </section>
              )}
              {tab === "security" && (
                <Security state={state} sandbox={sandbox} />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Mark small />
              GameSwitch <span>auf Basis von PufferPanel</span>
            </span>
            <span>
              <ShieldCheck size={14} />
              Für deine nächste gute Session.
            </span>
          </footer>
        </main>
      </div>

      {modal?.type === "create" && (
        <CreateProfile
          catalog={state?.catalog || []}
          host={state?.host}
          initialGameId={modal.gameId}
          onClose={() => setModal(null)}
          onCreated={async () => {
            setModal(null);
            setNotice("Spielprofil angelegt. Du kannst es jetzt starten.");
            await refresh();
          }}
        />
      )}
      {modal && modal.type !== "create" && (
        <ConfirmModal
          modal={modal}
          profiles={profiles}
          active={active}
          sandbox={sandbox}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onConfirm={() =>
            modal.type === "restore"
              ? mutate(
                  `/backups/${encodeURIComponent(modal.backup.id)}/restore`,
                )
              : mutate(
                  `/profiles/${encodeURIComponent(modal.profile.id)}/${modal.type}`,
                )
          }
        />
      )}
      {consoleProfile && (
        <Modal
          title="Serverkonsole"
          subtitle={consoleProfile.name}
          wide
          onClose={() => setConsoleProfile(null)}
        >
          <div className="console-toolbar">
            <span className="terminal-status">
              <span className="status-dot" />
              {sandbox ? "Sandbox-Protokoll" : "Serverausgabe"}
            </span>
            <span>Nur Lesezugriff</span>
          </div>
          <pre className="console-output">
            {consoleLines.length
              ? consoleLines.join("\n")
              : "Noch keine Konsolenausgabe vorhanden."}
          </pre>
          <div className="modal-footer">
            <p>
              <LockKeyhole size={14} />
              Keine freien Shell-Befehle über diese Oberfläche.
            </p>
            <button
              className="button subtle"
              onClick={() => setConsoleProfile(null)}
            >
              Schließen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Auth({ session, onAuthenticated }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setup = session.setupRequired;
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAuthenticated(
        await api(setup ? "/setup" : "/login", {
          method: "POST",
          body: setup ? { username, password, token } : { username, password },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-shell">
      <div className="auth-story">
        <a className="brand" href="#">
          <Mark />
          <span>
            Game<span className="brand-light">Switch</span>
          </span>
        </a>
        <div className="auth-story-content">
          <span className="eyebrow">DEIN SERVER. DEINE SPIELE.</span>
          <h1>
            Die nächste Session.
            <br />
            <em>Nur einen Klick entfernt.</em>
          </h1>
          <p>
            Deine Minecraft-Welten, deine Modpacks, deine Garry’s-Mod-Runden.
            Zusammen auf deinem Server.
          </p>
          <div className="auth-art">
            <GameArt />
            <GameArt game="gmod" />
          </div>
          <div className="auth-promise">
            <ShieldCheck size={20} />
            <span>Sicher wechseln. Spielstände behalten.</span>
          </div>
        </div>
        <span className="auth-credit">
          GAME SERVER MANAGEMENT · POWERED BY PUFFERPANEL
        </span>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form">
          <span className="auth-lock">
            <LockKeyhole size={25} />
          </span>
          <div className="eyebrow">DEIN WORKSPACE</div>
          <h2>
            {setup ? "Willkommen bei GameSwitch." : "Schön, dass du da bist."}
          </h2>
          <p>
            {setup
              ? "Richte deinen Administratorzugang ein, um loszulegen."
              : "Melde dich an und mach deinen Server spielbereit."}
          </p>
          {error && (
            <div className="alert alert-error" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={submit}>
            {setup && (
              <label>
                Einrichtungstoken
                <input
                  autoComplete="off"
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Token aus dem lokalen Serverterminal"
                />
                <small>
                  Wird beim ersten Serverstart lokal im Terminal angezeigt.
                </small>
              </label>
            )}
            <label>
              Benutzername
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_-]{3,32}"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Dein Benutzername"
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                required
                minLength={setup ? 14 : undefined}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={setup ? "Mindestens 14 Zeichen" : "Dein Passwort"}
              />
              {setup && (
                <small>Verwende ein langes, einzigartiges Passwort.</small>
              )}
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
              {setup ? "Workspace einrichten" : "Sicher anmelden"}
            </button>
          </form>
          <div className="auth-security">
            <ShieldCheck size={16} />
            <span>
              Geschützte Sitzung · Keine Zugangsdaten im Browser-Speicher
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  active,
  sandbox,
  disabled,
  onActivate,
  onConsole,
  onBackup,
}) {
  const minecraft = isMinecraft(profile);
  return (
    <article className={`profile-card panel ${active ? "active-card" : ""}`}>
      <div className="profile-art-wrapper">
        <GameArt game={profile.gameId} />
        <span className={`profile-status ${active ? "is-active" : ""}`}>
          <span className="status-dot" />
          {active
            ? sandbox
              ? "Simuliert aktiv"
              : "Aktiv"
            : profile.status === "unknown"
              ? "Status unbekannt"
              : "Pausiert"}
        </span>
      </div>
      <div className="profile-details">
        <span className="profile-game-name">
          {gameName(profile.gameId)}
          <span>·</span>
          {minecraft
            ? loaderName(profile.loader)
            : profile.gamemode === "terrortown"
              ? "Trouble in Terrorist Town"
              : "Sandbox"}
        </span>
        <h3>{profile.name}</h3>
        <p className="profile-version">
          {minecraft
            ? profile.modpackId
              ? `${profile.modpackName || "Modpack"} · ${profile.modpackVersionName || profile.version}`
              : `Minecraft ${profile.version}`
            : profile.collectionId
              ? `Collection #${profile.collectionId}`
              : profile.map || "Sandbox"}
        </p>
        <div className="profile-meta">
          <span>
            <MemoryStick size={14} />
            {ram(profile.memoryMb)}
          </span>
          <span>
            <Gamepad2 size={14} />
            {profile.maxPlayers} Slots
          </span>
          <span>
            <Server size={14} />:{profile.port}
          </span>
        </div>
        <div className="profile-actions">
          <button
            className={`button ${active ? "subtle" : "primary-soft"}`}
            disabled={disabled || profile.status === "unknown"}
            onClick={active ? onConsole : onActivate}
          >
            {active ? <Terminal size={15} /> : <Power size={15} />}
            {active ? "Konsole öffnen" : "Profil starten"}
            {!active && <ArrowRight size={15} />}
          </button>
          <button
            className="icon-button"
            title={
              active
                ? "Für ein manuelles Backup zuerst stoppen"
                : "Backup erstellen"
            }
            aria-label={`Backup für ${profile.name} erstellen`}
            disabled={disabled || active || profile.status === "unknown"}
            onClick={onBackup}
          >
            <Database size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}

function JobProgress({ job, profiles }) {
  const profile = profiles.find((p) => p.id === job.profileId);
  return (
    <section
      className={`panel job-panel ${job.status === "failed" ? "job-failed" : ""}`}
      aria-live="polite"
    >
      <div className="job-heading">
        <span
          className={`job-icon ${job.status === "running" ? "working" : ""}`}
        >
          {job.status === "running" ? (
            <LoaderCircle className="spin" size={19} />
          ) : job.status === "failed" ? (
            <TriangleAlert size={19} />
          ) : (
            <CheckCheck size={19} />
          )}
        </span>
        <div>
          <h3>
            {job.status === "running"
              ? "Dein Server macht sich bereit."
              : job.status === "failed"
                ? "Vorgang sicher angehalten."
                : "Alles bereit."}
          </h3>
          <p>
            {profile?.name || "Servervorgang"}
            {job.status === "failed"
              ? ` · ${job.error || "Bitte das Protokoll prüfen."}`
              : job.status === "completed"
                ? " · Vorgang abgeschlossen"
                : " · Du kannst den Fortschritt hier verfolgen."}
          </p>
        </div>
        <span className="tag">
          {job.status === "running"
            ? "IN ARBEIT"
            : job.status === "failed"
              ? "FEHLGESCHLAGEN"
              : "ABGESCHLOSSEN"}
        </span>
      </div>
      <div className="job-steps">
        {(job.steps || []).map((step, i) => (
          <div key={i} className={`job-step ${step.status}`}>
            <span>
              {step.status === "completed" ? (
                <Check size={13} />
              ) : step.status === "running" ? (
                <LoaderCircle className="spin" size={13} />
              ) : step.status === "failed" ? (
                <X size={13} />
              ) : (
                i + 1
              )}
            </span>
            <small>{step.label}</small>
            {i < job.steps.length - 1 && <div />}
          </div>
        ))}
      </div>
    </section>
  );
}

function EventList({ events, compact = false }) {
  if (!events.length)
    return (
      <div className="events-empty">
        <Clock3 size={22} />
        <span>Hier beginnt deine Servergeschichte.</span>
        <small>Neue Vorgänge erscheinen automatisch im Protokoll.</small>
      </div>
    );
  return (
    <div className={`event-list ${compact ? "compact" : ""}`}>
      {events.map((event) => (
        <div className="event" key={event.id}>
          <span className={`event-icon ${event.level}`}>
            {event.level === "error" || event.level === "warning" ? (
              <TriangleAlert size={14} />
            ) : (
              <Check size={14} />
            )}
          </span>
          <div>
            <p>{event.message}</p>
            <time>{date(event.time || event.createdAt)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

function Backups({ state, busy, onRestore, onNew }) {
  const backups = state.backups || [];
  return (
    <>
      <div className="backup-info">
        <ShieldCheck size={22} />
        <div>
          <strong>Ein sicherer Wechsel beginnt mit einem Backup.</strong>
          <p>
            Beim Profilwechsel wird die alte Instanz sauber beendet und
            gesichert. Eine Wiederherstellung ist nur bei gestopptem Profil
            möglich.
          </p>
        </div>
      </div>
      <section className="panel backup-panel">
        <div className="section-top">
          <h2>
            Deine Sicherungen{" "}
            <span className="count-badge">{backups.length}</span>
          </h2>
          <span className="tag">PROFILWEISE GETRENNT</span>
        </div>
        {!backups.length ? (
          <div className="empty-state">
            <Database size={35} />
            <h3>Noch alles ganz frisch.</h3>
            <p>
              Nach deinem ersten Profilwechsel erscheint hier das Backup.
              <br />
              Manuelle Sicherungen erstellst du am gestoppten Spielprofil.
            </p>
            <button className="button subtle" onClick={onNew}>
              Zu den Spielprofilen <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sicherung</th>
                  <th>Spielprofil</th>
                  <th>Erstellt</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Aktionen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const profile = state.profiles.find(
                    (p) => p.id === backup.profileId,
                  );
                  const canRestore = profile?.status === "stopped";
                  return (
                    <tr key={backup.id}>
                      <td>
                        <span className="backup-file">
                          <Database size={18} />
                          <strong>
                            {backup.name || "Spielstand-Sicherung"}
                          </strong>
                        </span>
                      </td>
                      <td>{backup.profileName || profile?.name}</td>
                      <td>{date(backup.createdAt)}</td>
                      <td>
                        <span className="saved-badge">
                          <Check size={13} />
                          Gesichert
                        </span>
                      </td>
                      <td>
                        <button
                          className="button subtle small-button"
                          disabled={busy || !canRestore}
                          title={
                            !canRestore
                              ? "Profil vor der Wiederherstellung stoppen"
                              : "Sicherung wiederherstellen"
                          }
                          onClick={() => onRestore(backup)}
                        >
                          <RefreshCw size={14} />
                          Wiederherstellen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Security({ state, sandbox }) {
  const protections = [
    [
      "Geschützter Zugriff",
      "Anmeldung, Passwort-Hashing und sichere Sitzungscookies.",
      LockKeyhole,
      true,
    ],
    [
      "Schutz vor fremden Webanfragen",
      "CSRF-Token und Prüfung des Anfrageursprungs für Änderungen.",
      ShieldCheck,
      state.security?.csrf,
    ],
    [
      "Lokale Erreichbarkeit",
      state.security?.localOnly
        ? "Das Panel ist an die lokale Schnittstelle gebunden."
        : "Externe Erreichbarkeit konfiguriert. TLS und Firewall am VPS prüfen.",
      Server,
      state.security?.localOnly,
    ],
    [
      "Getrennte Spielstände",
      "Jedes Profil verwendet eine eigene Serverinstanz. Keine Welt wird beim Wechsel überschrieben.",
      Layers3,
      true,
    ],
  ];
  return (
    <div className="security-layout">
      <section className="panel security-main">
        <div className="security-title">
          <span>
            <ShieldCheck size={27} />
          </span>
          <div>
            <h2>Schutz auf mehreren Ebenen</h2>
            <p>
              Dein Workspace und deine Welten verdienen einen sicheren Platz.
            </p>
          </div>
        </div>
        {protections.map(([title, description, Icon, enabled]) => (
          <div className="protection-row" key={title}>
            <Icon size={20} />
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <span className={`protection-state ${enabled ? "" : "review"}`}>
              {enabled ? <CheckCheck size={17} /> : <TriangleAlert size={17} />}
              {enabled ? "Aktiv" : "Prüfen"}
            </span>
          </div>
        ))}
      </section>
      <aside className="panel connection-panel">
        <span className="section-kicker">
          <Settings2 size={15} />
          LAUFZEITUMGEBUNG
        </span>
        <h3>{sandbox ? "Lokale Sandbox" : "PufferPanel"}</h3>
        <p>
          {sandbox
            ? "Hier testest du den vollständigen Bedienablauf. Es laufen noch keine echten Spieleprozesse."
            : "Spielprofile werden über die PufferPanel-API bereitgestellt und gesteuert."}
        </p>
        <div className="connection-fact">
          <span>VPS-Deployment</span>
          <strong>
            {sandbox ? "Noch ausstehend" : "PufferPanel konfiguriert"}
          </strong>
        </div>
        <div className="connection-fact">
          <span>SSH-/API-Schlüssel</span>
          <strong>Nur serverseitig</strong>
        </div>
        <div className="connection-fact">
          <span>Freie Shell-Befehle</span>
          <strong>Nicht freigegeben</strong>
        </div>
        <div className="system-note">
          <TriangleAlert size={16} />
          <p>
            Administrationszugang über SSH-Tunnel oder HTTPS schützen und
            Backups zusätzlich außerhalb des VPS speichern. Lokale Backups
            schützen nicht vor einem kompletten VPS-Ausfall.
          </p>
        </div>
        <a
          className="text-button external-link"
          href="https://github.com/lukyjack/gameswitch"
          target="_blank"
          rel="noreferrer"
        >
          Quellcode & Einrichtung <ExternalLink size={14} />
        </a>
      </aside>
    </div>
  );
}

function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () =>
      ref.current?.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      );
    focusable()?.[0]?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const list = focusable();
        if (!list?.length) return;
        if (event.shiftKey && document.activeElement === list[0]) {
          event.preventDefault();
          list[list.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === list[list.length - 1]
        ) {
          event.preventDefault();
          list[0].focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Dialog schließen"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ConfirmModal({
  modal,
  profiles,
  active,
  sandbox,
  busy,
  error,
  onClose,
  onConfirm,
}) {
  const type = modal.type;
  const restore = type === "restore";
  const target = restore
    ? profiles.find((p) => p.id === modal.backup.profileId)
    : modal.profile;
  const switchProfile =
    type === "activate" && active && active.id !== target?.id;
  const title = restore
    ? "Spielstand wiederherstellen?"
    : type === "stop"
      ? "Session beenden?"
      : type === "backup"
        ? "Spielstand sichern?"
        : switchProfile
          ? "Bereit für den Spielewechsel?"
          : "Deine Session starten?";
  return (
    <Modal
      title={title}
      subtitle={target?.name}
      onClose={busy ? () => {} : onClose}
    >
      <div className="confirm-body">
        {error && (
          <div className="alert alert-error" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className={`confirm-symbol ${type === "stop" ? "amber" : ""}`}>
          {restore ? (
            <RefreshCw size={29} />
          ) : type === "backup" ? (
            <Database size={29} />
          ) : type === "stop" ? (
            <Power size={29} />
          ) : (
            <Gamepad2 size={29} />
          )}
        </div>
        {restore ? (
          <>
            <p>
              Die Sicherung <strong>{modal.backup.name}</strong> vom{" "}
              {date(modal.backup.createdAt)} ersetzt den aktuellen Stand dieses
              Profils.
            </p>
            <div className="inline-note">
              <ShieldCheck size={18} />
              Vorher wird der aktuelle Stand als Sicherheitsbackup gesichert.
            </div>
          </>
        ) : type === "stop" ? (
          <p>
            Die Instanz wird sauber heruntergefahren. Dein Spielstand bleibt im
            Profil erhalten und du kannst später weiterspielen.
          </p>
        ) : type === "backup" ? (
          <p>
            Der aktuelle Stand des gestoppten Profils wird gesichert. Das Profil
            bleibt dabei ausgeschaltet.
          </p>
        ) : (
          <>
            <p>
              {switchProfile ? (
                <>
                  Die Session <strong>{active.name}</strong> wird beendet.
                  Danach startet <strong>{target?.name}</strong> mit seinem
                  eigenen Spielstand.
                </>
              ) : (
                <>
                  Dein Profil <strong>{target?.name}</strong> wird vorbereitet
                  und gestartet.
                </>
              )}
            </p>
            <div className="switch-flow">
              {(switchProfile
                ? [
                    "Sauber stoppen & speichern",
                    "Backup fertigstellen",
                    "Neues Profil starten",
                  ]
                : [
                    "Profil vorbereiten",
                    "Installation prüfen",
                    "Server starten",
                  ]
              ).map((label, index) => (
                <div key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  {index < 2 && <ChevronRight size={15} />}
                </div>
              ))}
            </div>
            {switchProfile && (
              <div className="inline-note">
                <ShieldCheck size={18} />
                Der neue Server startet erst nach erfolgreichem Backup.
              </div>
            )}
          </>
        )}
        {sandbox && (
          <p className="confirm-sandbox">
            <Box size={14} />
            Dieser Vorgang wird in der lokalen Sandbox ausgeführt.
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="button subtle" disabled={busy} onClick={onClose}>
          Abbrechen
        </button>
        <button className="button primary" disabled={busy} onClick={onConfirm}>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : type === "stop" ? (
            <Square size={14} />
          ) : (
            <ArrowRight size={16} />
          )}
          {restore
            ? "Wiederherstellen"
            : type === "stop"
              ? "Session beenden"
              : type === "backup"
                ? "Backup erstellen"
                : switchProfile
                  ? "Sicher wechseln"
                  : "Profil starten"}
        </button>
      </div>
    </Modal>
  );
}

function CreateProfile({ catalog, host, initialGameId, onClose, onCreated }) {
  const initial = catalog.find((g) => g.id === initialGameId) || catalog[0];
  const [step, setStep] = useState(initialGameId ? 2 : 1);
  const [game, setGame] = useState(initial);
  const [form, setForm] = useState({
    name: "",
    loader: initial?.loaders?.[0] || "vanilla",
    version: "",
    memoryMb: initial?.defaultMemoryMb || 4096,
    port: initial?.defaultPort || 25565,
    maxPlayers: 20,
    collectionId: "",
    gamemode: "sandbox",
    map: "gm_construct",
    eulaAccepted: false,
    modpackId: "",
    modpackVersion: "",
  });
  const [versions, setVersions] = useState([]);
  const [packQuery, setPackQuery] = useState("");
  const [packs, setPacks] = useState([]);
  const [selectedPack, setSelectedPack] = useState(null);
  const [packVersions, setPackVersions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const providerGeneration = useRef(0);
  const versionGeneration = useRef(0);
  const versionAbort = useRef(null);
  const minecraft = game?.kind === "minecraft" || game?.id === "minecraft";
  const memoryMax = Math.min(
    13312,
    (host?.memoryMb || 16384) - (host?.reservedMemoryMb || 3072),
  );
  const memoryReserve = host?.reservedMemoryMb || 3072;
  const modpack = ["modrinth", "ftb"].includes(form.loader);
  const ftb = form.loader === "ftb";
  const packSource = ftb ? "/catalog/ftb" : "/catalog/modpacks";
  const selectedVersion = packVersions.find(
    (version) => String(version.id) === form.modpackVersion,
  );
  const update = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  useEffect(() => {
    api("/catalog/minecraft-versions")
      .then((data) => {
        const list = data.versions || [];
        setVersions(list);
        if (list[0])
          setForm((previous) => ({
            ...previous,
            version: previous.version || list[0],
          }));
      })
      .catch((e) =>
        setError(
          `Minecraft-Versionen konnten nicht geladen werden: ${e.message}`,
        ),
      );
  }, []);
  useEffect(() => {
    if (!modpack) return;
    let cancelled = false;
    const generation = providerGeneration.current;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api(
          `${packSource}?q=${encodeURIComponent(packQuery)}`,
          { signal: abort.signal },
        );
        if (!cancelled && generation === providerGeneration.current)
          setPacks(data.hits || []);
      } catch (e) {
        if (!cancelled && generation === providerGeneration.current)
          setError(e.message);
      } finally {
        if (!cancelled && generation === providerGeneration.current)
          setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [packQuery, modpack, packSource]);
  useEffect(
    () => () => {
      providerGeneration.current += 1;
      versionGeneration.current += 1;
      versionAbort.current?.abort();
    },
    [],
  );
  const clearPack = () => {
    versionGeneration.current += 1;
    versionAbort.current?.abort();
    setSelectedPack(null);
    setPackVersions([]);
    setForm((previous) => ({
      ...previous,
      modpackId: "",
      modpackVersion: "",
      version: versions[0] || "",
    }));
  };
  const selectLoader = (loader) => {
    providerGeneration.current += 1;
    clearPack();
    setPacks([]);
    setSearching(false);
    setError("");
    setPackQuery(loader === "ftb" ? "evolution" : "");
    setForm((previous) => ({
      ...previous,
      loader,
      memoryMb:
        loader === "ftb" ? Math.min(10240, memoryMax) : previous.memoryMb,
    }));
  };
  const selectGame = (next) => {
    providerGeneration.current += 1;
    clearPack();
    setPacks([]);
    setPackQuery("");
    setSearching(false);
    setGame(next);
    setForm((previous) => ({
      ...previous,
      loader:
        next.loaders?.[0] || (next.id === "minecraft" ? "vanilla" : "steam"),
      memoryMb: next.defaultMemoryMb,
      port: next.defaultPort,
    }));
  };
  const selectPack = async (pack) => {
    const generation = ++versionGeneration.current;
    const provider = providerGeneration.current;
    versionAbort.current?.abort();
    const abort = new AbortController();
    versionAbort.current = abort;
    setSelectedPack(pack);
    setPackVersions([]);
    update("modpackId", String(pack.id));
    update("modpackVersion", "");
    setError("");
    try {
      const data = await api(
        `${packSource}/${encodeURIComponent(pack.id)}/versions`,
        { signal: abort.signal },
      );
      if (
        generation !== versionGeneration.current ||
        provider !== providerGeneration.current
      )
        return;
      setPackVersions(data.versions || []);
      const first = data.versions?.[0];
      if (!first)
        setError(
          "Für dieses Modpack sind derzeit keine Serverversionen verfügbar.",
        );
      if (first)
        setForm((previous) => ({
          ...previous,
          modpackVersion: String(first.id),
          version: first.gameVersions?.[0] || previous.version,
        }));
    } catch (e) {
      if (
        generation === versionGeneration.current &&
        provider === providerGeneration.current
      )
        setError(e.message);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let collectionId = form.collectionId.trim();
      if (collectionId.startsWith("https://")) {
        const url = new URL(collectionId);
        if (
          url.hostname !== "steamcommunity.com" ||
          !["/sharedfiles/filedetails/", "/workshop/filedetails/"].includes(
            url.pathname,
          )
        )
          throw new Error(
            "Bitte eine Steam-Collection-ID oder eine gültige steamcommunity.com-Collection-URL eintragen.",
          );
        collectionId = url.searchParams.get("id") || "";
      }
      const payload = {
        name: form.name.trim(),
        gameId: game.id,
        loader: form.loader,
        version: minecraft ? form.version : "latest",
        memoryMb: Number(form.memoryMb),
        port: Number(form.port),
        maxPlayers: Number(form.maxPlayers),
        ...(minecraft
          ? { eulaAccepted: form.eulaAccepted }
          : {
              collectionId,
              gamemode: form.gamemode,
              map: form.map.trim(),
            }),
      };
      if (modpack) {
        payload.modpackId = form.modpackId;
        payload.modpackVersion = form.modpackVersion;
      }
      await api("/profiles", { method: "POST", body: payload });
      await onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Dein nächstes Spielprofil"
      subtitle="Ein eigener Platz für dein Spiel, deine Mods und deine Welt."
      onClose={busy ? () => {} : onClose}
      wide
    >
      <div className="create-progress">
        <span className={step === 1 ? "current" : "done"}>
          <b>{step > 1 ? <Check size={12} /> : "1"}</b>Spiel auswählen
        </span>
        <div />
        <span className={step === 2 ? "current" : ""}>
          <b>2</b>Profil einrichten
        </span>
      </div>
      {step === 1 ? (
        <>
          <div className="game-select-grid">
            {catalog.map((item) => (
              <button
                className={`game-select ${game?.id === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => selectGame(item)}
              >
                <GameArt game={item.id} compact />
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <span className="select-radio">
                    {game?.id === item.id && <Check size={13} />}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="modal-footer">
            <p>
              <Layers3 size={15} />
              Weitere Spiele über vertrauenswürdige Vorlagen erweiterbar.
            </p>
            <button
              className="button primary"
              disabled={!game}
              onClick={() => setStep(2)}
            >
              Weiter <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="create-form-body">
            {error && (
              <div className="alert alert-error" role="alert">
                <TriangleAlert size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="selected-game">
              <span className={`game-mini ${minecraft ? "green" : "blue"}`}>
                {minecraft ? <Box size={20} /> : <span>g</span>}
              </span>
              <strong>{game?.name}</strong>
              <button
                className="text-button"
                type="button"
                onClick={() => setStep(1)}
              >
                Ändern
              </button>
            </div>
            <label>
              Profilname
              <input
                autoFocus
                required
                minLength={2}
                maxLength={60}
                placeholder={
                  minecraft
                    ? "z. B. Die Feierabend-Welt"
                    : "z. B. Garry’s Mod mit Freunden"
                }
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            {minecraft ? (
              <>
                <div className="form-row">
                  <label>
                    Servertyp
                    <select
                      value={form.loader}
                      onChange={(e) => selectLoader(e.target.value)}
                    >
                      {(
                        game?.loaders || [
                          "vanilla",
                          "paper",
                          "fabric",
                          "forge",
                          "modrinth",
                          "ftb",
                        ]
                      ).map((loader) => (
                        <option key={loader} value={loader}>
                          {loaderName(loader)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Minecraft-Version
                    <select
                      required
                      value={form.version}
                      disabled={modpack}
                      onChange={(e) => update("version", e.target.value)}
                    >
                      {!versions.length && (
                        <option value="">Versionen werden geladen …</option>
                      )}
                      {versions.map((version) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                      {form.version && !versions.includes(form.version) && (
                        <option value={form.version}>{form.version}</option>
                      )}
                    </select>
                  </label>
                </div>
                {modpack && (
                  <div className="modpack-selector">
                    <div className="label-line">
                      <strong>Modpack auswählen</strong>
                      <span className="tag">
                        {ftb ? "FEED THE BEAST" : "MODRINTH"}
                      </span>
                    </div>
                    {selectedPack ? (
                      <>
                        <div className="selected-pack">
                          <Box size={21} />
                          <div>
                            <strong>{selectedPack.title}</strong>
                            <small>{selectedPack.description}</small>
                          </div>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Anderes Modpack auswählen"
                            onClick={clearPack}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <label>
                          Modpack-Version
                          <select
                            required
                            value={form.modpackVersion}
                            onChange={(e) => {
                              const chosen = packVersions.find(
                                (v) => String(v.id) === e.target.value,
                              );
                              setForm((previous) => ({
                                ...previous,
                                modpackVersion: e.target.value,
                                version:
                                  chosen?.gameVersions?.[0] || previous.version,
                              }));
                            }}
                          >
                            {!packVersions.length && (
                              <option value="">
                                Versionen werden geladen …
                              </option>
                            )}
                            {packVersions.map((version) => (
                              <option key={version.id} value={version.id}>
                                {version.name || version.version} · MC{" "}
                                {version.gameVersions?.join(", ")}
                              </option>
                            ))}
                          </select>
                          {ftb && selectedVersion && (
                            <small>
                              Java{" "}
                              {selectedVersion.javaVersion || "laut Modpack"}
                              {selectedVersion.recommendedMemoryMb
                                ? ` · FTB empfiehlt ${ram(selectedVersion.recommendedMemoryMb)} Java-RAM.`
                                : "."}{" "}
                              Für das Profil zusätzlich 768 MB Prozessreserve
                              einplanen.
                            </small>
                          )}
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="pack-search">
                          <Search size={16} />
                          <input
                            aria-label={
                              ftb
                                ? "FTB-Modpacks suchen"
                                : "Modrinth-Modpacks suchen"
                            }
                            placeholder={
                              ftb
                                ? "FTB-Modpacks suchen …"
                                : "Modrinth-Modpacks suchen …"
                            }
                            value={packQuery}
                            onChange={(e) => setPackQuery(e.target.value)}
                          />
                        </label>
                        <div className="pack-results">
                          {searching ? (
                            <div className="pack-loading">
                              <LoaderCircle className="spin" size={19} />
                              Modpacks werden gesucht …
                            </div>
                          ) : packs.length ? (
                            packs.map((pack) => (
                              <button
                                type="button"
                                key={pack.id}
                                onClick={() => selectPack(pack)}
                              >
                                <span className="pack-icon">
                                  <Box size={18} />
                                </span>
                                <span>
                                  <strong>{pack.title}</strong>
                                  <small>{pack.description}</small>
                                </span>
                                <ChevronRight size={16} />
                              </button>
                            ))
                          ) : (
                            <div className="pack-loading">
                              Keine passenden Modpacks gefunden.
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <label>
                  Spielmodus
                  <select
                    value={form.gamemode}
                    onChange={(event) => {
                      const gamemode = event.target.value;
                      setForm((previous) => ({
                        ...previous,
                        gamemode,
                        map: gamemode === "terrortown" ? "" : "gm_construct",
                      }));
                    }}
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="terrortown">
                      Trouble in Terrorist Town (TTT)
                    </option>
                  </select>
                </label>
                <label>
                  Steam-Workshop-Collection{" "}
                  <span className="optional">optional</span>
                  <input
                    maxLength={200}
                    value={form.collectionId}
                    onChange={(e) => update("collectionId", e.target.value)}
                    placeholder="Collection-ID oder Steam-Collection-URL"
                  />
                  <small>
                    Eine öffentliche Collection verwenden. Einzelne Addons zu
                    deiner Collection hinzufügen.
                  </small>
                </label>
                <label>
                  Startkarte
                  <input
                    required
                    maxLength={80}
                    value={form.map}
                    onChange={(e) => update("map", e.target.value)}
                    placeholder={
                      form.gamemode === "terrortown"
                        ? "ttt_meine_karte"
                        : "gm_construct"
                    }
                  />
                  {form.gamemode === "terrortown" && (
                    <small>
                      Trage den genauen Namen einer TTT-Karte aus deiner
                      Workshop-Collection ein, ohne .bsp. Die Karte wird nicht
                      automatisch erkannt.
                    </small>
                  )}
                </label>
              </>
            )}
            <div className="resource-section">
              <div className="label-line">
                <strong>Arbeitsspeicher</strong>
                <span className="ram-value">{ram(form.memoryMb)}</span>
              </div>
              <input
                type="range"
                aria-label="Arbeitsspeicher in MB"
                min="1024"
                max={memoryMax}
                step="512"
                value={form.memoryMb}
                onChange={(e) => update("memoryMb", Number(e.target.value))}
              />
              <div className="range-labels">
                <span>1 GB</span>
                <span>{ram(memoryReserve)} bleiben für System &amp; Panel</span>
                <span>{ram(memoryMax)}</span>
              </div>
            </div>
            <div className="form-row">
              <label>
                Serverport
                <input
                  type="number"
                  required
                  min="1024"
                  max="65535"
                  value={form.port}
                  onChange={(e) => update("port", e.target.value)}
                />
              </label>
              <label>
                Spielerplätze
                <input
                  type="number"
                  required
                  min="1"
                  max="128"
                  value={form.maxPlayers}
                  onChange={(e) => update("maxPlayers", e.target.value)}
                />
              </label>
            </div>
            {minecraft && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.eulaAccepted}
                  required
                  onChange={(e) => update("eulaAccepted", e.target.checked)}
                />
                <span>
                  Ich akzeptiere die{" "}
                  <a
                    href="https://www.minecraft.net/eula"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Minecraft EULA <ExternalLink size={11} />
                  </a>{" "}
                  für dieses Serverprofil.
                </span>
              </label>
            )}
            <div className="inline-note">
              <ShieldCheck size={17} />
              Ein neues Profil bekommt einen eigenen Spielstand. Deine
              vorhandenen Welten bleiben erhalten.
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="button subtle"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={15} />
              Zurück
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                (modpack && !form.modpackVersion) ||
                (minecraft && !form.version)
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Plus size={17} />
              )}
              Profil erstellen
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
