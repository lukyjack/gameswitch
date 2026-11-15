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
const gameNames = {
  minecraft: "Minecraft",
  gmod: "Garry’s Mod",
  garrysmod: "Garry’s Mod",
  squad: "Squad",
  valheim: "Valheim",
  terraria: "Terraria",
  factorio: "Factorio",
  fs25: "Farming Simulator 25",
};
const gameName = (id) => gameNames[id] || id;
const gameLetter = (id) =>
  ({
    gmod: "g",
    garrysmod: "g",
    squad: "SQ",
    valheim: "V",
    terraria: "T",
    factorio: "F",
    fs25: "FS25",
  })[id] || "?";
const defaultGameVersion = (game) =>
  game?.defaultVersion ||
  (game?.id === "terraria"
    ? "1.4.5.8"
    : game?.id === "factorio"
      ? "2.1.24"
      : game?.id === "minecraft"
        ? ""
        : "latest");
const gameCapabilities = (gameId, catalog = []) =>
  catalog.find((game) => game.id === gameId) || {
    consoleInput: [
      "minecraft",
      "gmod",
      "terraria",
      "squad",
      "factorio",
    ].includes(gameId),
    adminKind:
      {
        minecraft: "minecraft",
        gmod: "ulx",
        valheim: "valheim",
        squad: "squad",
      }[gameId] || "none",
  };
const isMinecraft = (profile) => profile?.gameId === "minecraft";
const defaultGamePlayers = (game) =>
  Math.min(game?.id === "factorio" ? 16 : 20, game?.maxPlayers || 128);
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
    native: "Nativ",
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
  const gmod = ["gmod", "garrysmod"].includes(game);
  return (
    <div
      className={`game-art art-${gmod ? "gmod" : game} ${!minecraft && !gmod ? "art-native" : ""} ${compact ? "compact" : ""}`}
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
      ) : gmod ? (
        <>
          <span className="gmod-letter">g</span>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-cross">+</div>
        </>
      ) : (
        <span className="native-game-letter">{gameLetter(game)}</span>
      )}
      <div className="art-caption">
        <span>
          {minecraft
            ? "BUILD SOMETHING GREAT"
            : gmod
              ? "YOUR SANDBOX. YOUR RULES."
              : "DEINE WELT. DEIN SERVER."}
        </span>
        <strong>{gameName(game).toUpperCase()}</strong>
      </div>
    </div>
  );
}

function GameBadge({ game, size = 21 }) {
  return (
    <span
      className={`game-mini game-mini-${game} ${game === "minecraft" ? "green" : "blue"}`}
      aria-hidden="true"
    >
      {game === "minecraft" ? (
        <Box size={size} />
      ) : (
        <span>{gameLetter(game)}</span>
      )}
    </span>
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
  const mutationInFlight = useRef(false);
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
    if (mutationInFlight.current || runningJob) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: {} });
      setModal(null);
      if (success) setNotice(success);
      await refresh();
    } catch (e) {
      if (e.status === 401) {
        csrfToken = "";
        setModal(null);
        setConsoleProfile(null);
        setSession({ authenticated: false });
      } else setError(e.message);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };
  const requestRestart = (profile) => {
    if (
      busy ||
      runningJob ||
      profile.status !== "running" ||
      gameCapabilities(profile.gameId, state?.catalog).available === false
    )
      return;
    setError("");
    setModal({ type: "restart", profile });
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
      if (e.status === 401) {
        csrfToken = "";
        setConsoleProfile(null);
        setSession({ authenticated: false });
      } else setError(e.message);
    }
  };
  useEffect(() => {
    if (!consoleProfile) return;
    const timer = setInterval(
      () =>
        api(`/profiles/${encodeURIComponent(consoleProfile.id)}/console`)
          .then((d) => setConsoleLines(d.lines || []))
          .catch((e) => {
            if (e.status === 401) {
              csrfToken = "";
              setConsoleProfile(null);
              setSession({ authenticated: false });
            }
          }),
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
                            className={`active-icon ${active && !isMinecraft(active) ? "blue" : ""} ${active?.gameId === "factorio" ? "active-icon-factorio" : ""}`}
                          >
                            {active && !isMinecraft(active) ? (
                              <span className="active-game-letter">
                                {gameLetter(active.gameId)}
                              </span>
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
                                className="button subtle"
                                disabled={
                                  busy ||
                                  runningJob ||
                                  gameCapabilities(active.gameId, state.catalog)
                                    .available === false ||
                                  active.status !== "running"
                                }
                                onClick={() => requestRestart(active)}
                              >
                                <RefreshCw size={15} />
                                Neu starten
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
                            game={gameCapabilities(
                              profile.gameId,
                              state.catalog,
                            )}
                            disabled={busy || runningJob}
                            onActivate={() =>
                              setModal({ type: "activate", profile })
                            }
                            onConsole={() => showConsole(profile)}
                            onRestart={() => requestRestart(profile)}
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
                              className={
                                game.available === false
                                  ? "game-library-unavailable"
                                  : undefined
                              }
                              disabled={runningJob || game.available === false}
                              title={
                                game.unavailableReason ||
                                game.notice ||
                                game.description
                              }
                              onClick={() =>
                                setModal({ type: "create", gameId: game.id })
                              }
                            >
                              <GameBadge game={game.id} />
                              <span>
                                <strong>{game.name}</strong>
                                <small>
                                  {game.available === false
                                    ? game.unavailableReason
                                    : game.description}
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
          onUnauthorized={() => {
            csrfToken = "";
            setModal(null);
            setSession({ authenticated: false });
          }}
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
          runningJob={runningJob}
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
            <span>
              {gameCapabilities(consoleProfile.gameId, state.catalog)
                .consoleInput
                ? `${gameName(consoleProfile.gameId)}-Konsole`
                : "Nur Lesezugriff"}
            </span>
          </div>
          <pre className="console-output">
            {consoleLines.length
              ? consoleLines.join("\n")
              : "Noch keine Konsolenausgabe vorhanden."}
          </pre>
          {
            <ConsoleInput
              key={consoleProfile.id}
              profile={
                profiles.find((profile) => profile.id === consoleProfile.id) ||
                consoleProfile
              }
              sandbox={sandbox}
              game={gameCapabilities(consoleProfile.gameId, state.catalog)}
              locked={runningJob}
              onSent={async () => {
                try {
                  const result = await api(
                    `/profiles/${encodeURIComponent(consoleProfile.id)}/console`,
                  );
                  setConsoleLines(result.lines || []);
                } catch (e) {
                  if (e.status === 401) {
                    csrfToken = "";
                    setConsoleProfile(null);
                    setSession({ authenticated: false });
                  }
                }
              }}
              onUnauthorized={() => {
                csrfToken = "";
                setConsoleProfile(null);
                setSession({ authenticated: false });
              }}
            />
          }
          <div className="modal-footer">
            <p>
              <LockKeyhole size={14} />
              Befehle und Rechteverwaltung gelten nur für dieses Spielprofil.
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

function ConsoleInput({
  profile,
  game,
  sandbox,
  locked,
  onSent,
  onUnauthorized,
}) {
  const [command, setCommand] = useState("");
  const [player, setPlayer] = useState("");
  const [steamId, setSteamId] = useState("");
  const [role, setRole] = useState("admin");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const history = useRef([]);
  const sendingLock = useRef(false);
  const historyPosition = useRef(-1);
  const commandDraft = useRef("");
  const minecraft = isMinecraft(profile);
  const canInput = game.consoleInput === true;
  const adminKind = game.adminKind || "none";
  const hasSteamAdmin = ["ulx", "valheim", "squad"].includes(adminKind);
  const fileAdmin = ["valheim", "squad"].includes(adminKind);
  const unavailable = locked || profile.status !== "running";
  const adminUnavailable =
    locked ||
    (fileAdmin ? profile.status !== "stopped" : profile.status !== "running");
  const validPlayer = /^[A-Za-z0-9_]{3,16}$/.test(player.trim());
  const validSteamId = /^(?:STEAM_[01]:[01]:\d+|\d{17})$/.test(steamId.trim());

  const send = async (value, kind) => {
    if (sendingLock.current || unavailable || !canInput) return;
    const submitted = value.trim();
    if (
      !submitted ||
      submitted.length > 1024 ||
      /[\r\n\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(submitted)
    ) {
      setError(
        "Bitte einen einzelnen Befehl mit höchstens 1024 Zeichen eingeben.",
      );
      return;
    }
    sendingLock.current = true;
    setSending(true);
    setError("");
    setNotice("");
    try {
      await api(`/profiles/${encodeURIComponent(profile.id)}/console`, {
        method: "POST",
        body: { command: submitted },
      });
      history.current = [submitted, ...history.current].slice(0, 30);
      historyPosition.current = -1;
      commandDraft.current = "";
      if (kind === "operator") setPlayer("");
      else setCommand("");
      setNotice(
        sandbox
          ? "Befehl in der Sandbox angenommen. Hier läuft kein echter Spielserver."
          : "Befehl übermittelt. Ob er ausgeführt wurde, siehst du in der Serverausgabe.",
      );
      await onSent();
    } catch (e) {
      if (e.status === 401) onUnauthorized();
      else setError(e.message);
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  };

  const updateAdmin = async (event) => {
    event.preventDefault();
    if (sendingLock.current || adminUnavailable || !validSteamId) return;
    sendingLock.current = true;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await api(
        `/profiles/${encodeURIComponent(profile.id)}/admin`,
        {
          method: "POST",
          body: { steamId: steamId.trim(), role },
        },
      );
      setSteamId("");
      setNotice(
        `${result.notice || "Anfrage angenommen."}${result.requiresRestart ? " Die Liste gilt beim nächsten Start des Profils." : result.simulated ? " In der Sandbox simuliert." : " Die Serverausgabe zeigt die Rückmeldung."}`,
      );
      await onSent();
    } catch (e) {
      if (e.status === 401) onUnauthorized();
      else setError(e.message);
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  };

  return (
    <div className="console-controls">
      {canInput && unavailable && (
        <p className="console-help console-disabled" role="status">
          {locked
            ? "Während einer Serveraktion ist die Befehlseingabe gesperrt."
            : "Befehle sind nur für ein laufendes Spielprofil verfügbar."}
        </p>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}
      {canInput && (
        <form
          className="console-command-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(command, "command");
          }}
        >
          <label htmlFor="game-console-command">
            {gameName(profile.gameId)}-Befehl
          </label>
          <div className="console-input-row">
            <span aria-hidden="true" className="console-prompt">
              &gt;
            </span>
            <input
              id="game-console-command"
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                historyPosition.current = -1;
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowUp", "ArrowDown"].includes(event.key) ||
                  !history.current.length
                )
                  return;
                event.preventDefault();
                if (event.key === "ArrowUp") {
                  if (historyPosition.current === -1)
                    commandDraft.current = command;
                  historyPosition.current = Math.min(
                    historyPosition.current + 1,
                    history.current.length - 1,
                  );
                } else
                  historyPosition.current = Math.max(
                    historyPosition.current - 1,
                    -1,
                  );
                setCommand(
                  historyPosition.current === -1
                    ? commandDraft.current
                    : history.current[historyPosition.current],
                );
              }}
              maxLength={1024}
              required
              disabled={unavailable || sending}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                minecraft
                  ? "z. B. op DeinSpielername"
                  : profile.gameId === "gmod"
                    ? "z. B. status"
                    : profile.gameId === "terraria"
                      ? "z. B. playing"
                      : profile.gameId === "factorio"
                        ? "z. B. /promote DeinFactorioSpielername"
                        : "z. B. ListPlayers"
              }
              aria-describedby="game-console-help"
            />
            <button
              className="button primary"
              type="submit"
              disabled={unavailable || sending || !command.trim()}
            >
              {sending ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ArrowRight size={15} />
              )}
              Senden
            </button>
          </div>
          <p className="console-help" id="game-console-help">
            {profile.gameId === "factorio"
              ? "Factorio-Befehle mit führendem Schrägstrich eingeben und mit Enter senden."
              : "Ohne führenden Schrägstrich eingeben und mit Enter senden."}
            {" "}
            Beispiele:{" "}
            {minecraft ? (
              <>
                <code>list</code>, <code>op DeinSpielername</code>,{" "}
                <code>deop DeinSpielername</code>
              </>
            ) : profile.gameId === "gmod" ? (
              <>
                <code>status</code>, <code>ulx help</code> (ULX erforderlich)
              </>
            ) : profile.gameId === "terraria" ? (
              <>
                <code>help</code>, <code>playing</code>
              </>
            ) : profile.gameId === "factorio" ? (
              <>
                <code>/promote DeinFactorioSpielername</code>,{" "}
                <code>/demote DeinFactorioSpielername</code>,{" "}
                <code>/save {profile.worldName || "World"}</code>, <code>/help</code>
              </>
            ) : (
              <code>ListPlayers</code>
            )}
            . Während der Server noch lädt, kann die Antwort auf sich warten
            lassen. Zum Stoppen oder Neustarten die Profilsteuerung verwenden.
          </p>
        </form>
      )}
      {minecraft && (
        <form
          className="console-operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (validPlayer) send(`op ${player.trim()}`, "operator");
          }}
        >
          <div className="console-operator-title">
            <ShieldCheck size={18} />
            <div>
              <strong>Spieler zum Operator machen</strong>
              <p>Vergibt Administratorrechte in diesem Minecraft-Spielstand.</p>
            </div>
          </div>
          <label htmlFor="minecraft-operator-name">Minecraft-Spielername</label>
          <div className="console-input-row console-operator-row">
            <input
              id="minecraft-operator-name"
              value={player}
              onChange={(event) => setPlayer(event.target.value)}
              minLength={3}
              maxLength={16}
              pattern="[A-Za-z0-9_]{3,16}"
              required
              disabled={unavailable || sending}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="DeinSpielername"
              aria-describedby="minecraft-operator-help"
            />
            <button
              className="button primary-soft"
              type="submit"
              disabled={unavailable || sending || !validPlayer}
            >
              <ShieldCheck size={15} />
              Operator hinzufügen
            </button>
          </div>
          <p className="console-help" id="minecraft-operator-help">
            Java-Spielername mit 3–16 Buchstaben, Zahlen oder Unterstrichen. Die
            Rückmeldung erscheint oben in der Konsole.
          </p>
        </form>
      )}
      {hasSteamAdmin && (
        <form className="console-operator-form" onSubmit={updateAdmin}>
          <div className="console-operator-title">
            <ShieldCheck size={18} />
            <div>
              <strong>
                {adminKind === "ulx"
                  ? "ULX-Administrator verwalten"
                  : "Administratorliste verwalten"}
              </strong>
              <p>
                {adminKind === "ulx"
                  ? "ULX und ULib müssen bereits auf diesem Server geladen sein."
                  : "Die gespeicherte Administratorliste wird beim nächsten Profilstart verwendet."}
              </p>
            </div>
          </div>
          {fileAdmin && (
            <p className="console-help console-disabled" role="status">
              {profile.status === "stopped"
                ? "Das Profil ist gestoppt; die Liste kann bearbeitet werden."
                : "Zum Bearbeiten zuerst das Profil über die Profilsteuerung stoppen."}{" "}
              Das Hinzufügen oder Entfernen startet den Server nicht.
            </p>
          )}
          <div className="console-admin-fields">
            <label htmlFor="admin-steam-id">
              Steam-ID
              <input
                id="admin-steam-id"
                value={steamId}
                onChange={(event) => setSteamId(event.target.value)}
                maxLength={40}
                required
                pattern="(STEAM_[01]:[01]:[0-9]+|[0-9]{17})"
                disabled={adminUnavailable || sending}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="SteamID64 oder STEAM_0:1:123456"
                aria-describedby="steam-admin-help"
              />
            </label>
            <label htmlFor="admin-role">
              Berechtigung
              <select
                id="admin-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                disabled={adminUnavailable || sending}
              >
                <option value="admin">Administrator</option>
                {adminKind === "ulx" && (
                  <option value="superadmin">Superadministrator</option>
                )}
                <option value="user">Administratorrechte entfernen</option>
              </select>
            </label>
          </div>
          <div className="console-admin-footer">
            <p className="console-help" id="steam-admin-help">
              SteamID64 mit 17 Ziffern oder SteamID2 im Format STEAM_0:1:123456.{" "}
              {adminKind === "ulx"
                ? "Die Übermittlung bestätigt noch keine Ausführung; bitte die Rückmeldung in der Serverausgabe prüfen."
                : "Die Liste verwaltet die Administratorrechte für dieses Spielprofil."}
            </p>
            <button
              className="button primary-soft"
              type="submit"
              disabled={adminUnavailable || sending || !validSteamId}
            >
              {sending ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ShieldCheck size={15} />
              )}{" "}
              {role === "user" ? "Rechte entfernen" : "Rechte speichern"}
            </button>
          </div>
        </form>
      )}
      {profile.gameId === "valheim" && (
        <p className="console-help">
          Valheim unterstützt hier keine direkte Konsoleneingabe. Die
          Serverausgabe bleibt lesbar; Administratoren werden über die Liste
          verwaltet.
        </p>
      )}
      {profile.gameId === "terraria" && (
        <p className="console-help">
          Der native Terraria-Server hat keine separate Administratorgruppe. Die
          Serverkonsole steuert die Serverregeln und Spieler direkt.
        </p>
      )}
      {profile.gameId === "factorio" && (
        <p className="console-help">
          Administratorrechte werden mit{" "}
          <code>/promote ExakterFactorioSpielername</code> vergeben und mit{" "}
          <code>/demote ExakterFactorioSpielername</code> entfernt. Den
          tatsächlichen Namen des Factorio-Spielkontos exakt übernehmen. Der
          Beitritt erfolgt per Server-IP und Serverpasswort mit geprüftem
          Factorio-Konto.
        </p>
      )}
      {!canInput && !hasSteamAdmin && (
        <p className="console-help">
          Für dieses Spiel ist hier nur die Serverausgabe verfügbar.
        </p>
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
  game,
  active,
  sandbox,
  disabled,
  onActivate,
  onConsole,
  onRestart,
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
            : profile.gameId === "gmod"
              ? profile.gamemode === "terrortown"
                ? "Trouble in Terrorist Town"
                : "Sandbox"
              : loaderName(profile.loader)}
        </span>
        <h3>{profile.name}</h3>
        <p className="profile-version">
          {minecraft
            ? profile.modpackId
              ? `${profile.modpackName || "Modpack"} · ${profile.modpackVersionName || profile.version}`
              : `Minecraft ${profile.version}`
            : profile.gameId === "gmod"
              ? profile.collectionId
                ? `Collection #${profile.collectionId}`
                : profile.map || "Sandbox"
              : profile.worldName ||
                (profile.version === "latest"
                  ? "Aktuelle Serverversion"
                  : `Version ${profile.version}`)}
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
        <div className="profile-actions profile-actions-running">
          <button
            className={`button ${active ? "subtle" : "primary-soft"}`}
            disabled={
              disabled ||
              profile.status === "unknown" ||
              game?.available === false
            }
            title={game?.unavailableReason}
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
          {active && (
            <button
              className="button subtle profile-restart"
              disabled={
                disabled ||
                profile.status !== "running" ||
                game?.available === false
              }
              onClick={onRestart}
              aria-label={`${profile.name} neu starten`}
            >
              <RefreshCw size={15} />
              Neu starten
            </button>
          )}
          {!active && (
            <button
              className="button subtle profile-console"
              disabled={disabled}
              onClick={onConsole}
              aria-label={`Konsole und Administration für ${profile.name} öffnen`}
            >
              <Terminal size={15} />
              Konsole &amp; Admin
            </button>
          )}
        </div>
        {game?.available === false && (
          <p className="console-help">{game.unavailableReason}</p>
        )}
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
              ? job.type === "restart"
                ? "Neustart läuft."
                : "Dein Server macht sich bereit."
              : job.status === "failed"
                ? "Vorgang sicher angehalten."
                : job.type === "restart"
                  ? "Serverprozess neu gestartet."
                  : job.type === "activate"
                    ? "Serverprozess gestartet."
                    : "Vorgang abgeschlossen."}
          </h3>
          <p>
            {profile?.name || "Servervorgang"}
            {job.status === "failed"
              ? ` · ${job.error || "Bitte das Protokoll prüfen."}`
              : job.status === "completed"
                ? ["restart", "activate"].includes(job.type)
                  ? " · Die Welt kann noch laden; die Konsole zeigt den Fortschritt."
                  : " · Vorgang abgeschlossen"
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
  runningJob,
  error,
  onClose,
  onConfirm,
}) {
  const type = modal.type;
  const restore = type === "restore";
  const restart = type === "restart";
  const target = restore
    ? profiles.find((p) => p.id === modal.backup.profileId)
    : modal.profile;
  const switchProfile =
    type === "activate" && active && active.id !== target?.id;
  const restartUnavailable =
    restart &&
    profiles.find((profile) => profile.id === target?.id)?.status !== "running";
  const confirmDisabled = busy || runningJob || restartUnavailable;
  const title = restore
    ? "Spielstand wiederherstellen?"
    : restart
      ? "Server neu starten?"
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
        <div
          className={`confirm-symbol ${type === "stop" || restart ? "amber" : ""}`}
        >
          {restore ? (
            <RefreshCw size={29} />
          ) : restart ? (
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
        ) : restart ? (
          <>
            <p>
              <strong>{target?.name}</strong> wird kontrolliert neu gestartet.
              Alle verbundenen Spieler werden dabei getrennt.
            </p>
            <div className="switch-flow">
              {[
                "Speichern & sauber stoppen",
                "Backup abschließen",
                "Dasselbe Profil starten",
              ].map((label, index) => (
                <div key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  {index < 2 && <ChevronRight size={15} />}
                </div>
              ))}
            </div>
            <div className="inline-note">
              <ShieldCheck size={18} />
              Der Spielstand wird gesichert. Erst nach abgeschlossenem Backup
              startet dasselbe Profil mit seiner bisherigen Packversion.
            </div>
            <p className="restart-duration-note">
              Große Modpacks können beim erneuten Laden mehrere Minuten
              brauchen. Den Fortschritt siehst du in der Konsole.
            </p>
            {restartUnavailable && (
              <p className="inline-note" role="status">
                Das Profil läuft gerade nicht. Aktualisiere den Status, bevor du
                einen Neustart anforderst.
              </p>
            )}
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
        <button
          className="button primary"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : type === "stop" ? (
            <Square size={14} />
          ) : restart ? (
            <RefreshCw size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          {restore
            ? "Wiederherstellen"
            : restart
              ? "Neustart bestätigen"
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

function CreateProfile({
  catalog,
  host,
  initialGameId,
  onClose,
  onCreated,
  onUnauthorized,
}) {
  const initial =
    catalog.find((g) => g.id === initialGameId && g.available !== false) ||
    catalog.find((g) => g.available !== false) ||
    catalog[0];
  const [step, setStep] = useState(
    initialGameId && initial?.id === initialGameId ? 2 : 1,
  );
  const [game, setGame] = useState(initial);
  const [form, setForm] = useState({
    name: "",
    loader: initial?.loaders?.[0] || "vanilla",
    version: defaultGameVersion(initial),
    memoryMb: Math.min(
      initial?.defaultMemoryMb || 4096,
      Math.min(
        13312,
        (host?.memoryMb || 16384) - (host?.reservedMemoryMb || 3072),
      ),
    ),
    port: initial?.defaultPort || 25565,
    maxPlayers: defaultGamePlayers(initial),
    collectionId: "",
    gamemode: "sandbox",
    map: "gm_construct",
    eulaAccepted: false,
    modpackId: "",
    modpackVersion: "",
    serverPassword: "",
    worldName: "",
    queryPort: initial?.defaultQueryPort || 27165,
    beaconPort: initial?.defaultBeaconPort || 15000,
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
  const submitLock = useRef(false);
  const minecraft = game?.kind === "minecraft" || game?.id === "minecraft";
  const memoryMax = Math.min(
    13312,
    (host?.memoryMb || 16384) - (host?.reservedMemoryMb || 3072),
  );
  const memoryReserve = host?.reservedMemoryMb || 3072;
  const memoryMin = game?.minMemoryMb || 1024;
  const modpack = minecraft && ["modrinth", "ftb"].includes(form.loader);
  const ftb = form.loader === "ftb";
  const packSource = ftb ? "/catalog/ftb" : "/catalog/modpacks";
  const selectedVersion = packVersions.find(
    (version) => String(version.id) === form.modpackVersion,
  );
  const update = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  useEffect(() => {
    if (!minecraft) return;
    let cancelled = false;
    api("/catalog/minecraft-versions")
      .then((data) => {
        if (cancelled) return;
        const list = data.versions || [];
        setVersions(list);
        if (list[0])
          setForm((previous) => ({
            ...previous,
            version: previous.version || list[0],
          }));
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            `Minecraft-Versionen konnten nicht geladen werden: ${e.message}`,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [minecraft]);
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
        loader === "ftb" ? Math.min(12288, memoryMax) : previous.memoryMb,
    }));
  };
  const selectGame = (next) => {
    if (next.available === false) return;
    providerGeneration.current += 1;
    clearPack();
    setPacks([]);
    setPackQuery("");
    setSearching(false);
    setGame(next);
    setError("");
    setForm((previous) => ({
      ...previous,
      loader:
        next.loaders?.[0] || (next.id === "minecraft" ? "vanilla" : "default"),
      version:
        next.id === "minecraft" ? versions[0] || "" : defaultGameVersion(next),
      memoryMb: Math.min(next.defaultMemoryMb || 4096, memoryMax),
      port: next.defaultPort,
      maxPlayers: defaultGamePlayers(next),
      serverPassword: "",
      worldName: "",
      queryPort: next.defaultQueryPort || 27165,
      beaconPort: next.defaultBeaconPort || 15000,
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
    if (submitLock.current) return;
    if (!game || game.available === false || memoryMin > memoryMax) {
      setError(
        game?.unavailableReason ||
          "Für dieses Spiel stehen auf diesem Host nicht genug Ressourcen zur Verfügung.",
      );
      return;
    }
    submitLock.current = true;
    setError("");
    setBusy(true);
    try {
      let collectionId = game.id === "gmod" ? form.collectionId.trim() : "";
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
        version: minecraft ? form.version : defaultGameVersion(game),
        memoryMb: Number(form.memoryMb),
        port: Number(form.port),
        maxPlayers: Number(form.maxPlayers),
        ...(minecraft ? { eulaAccepted: form.eulaAccepted } : {}),
        ...(game.id === "gmod"
          ? { collectionId, gamemode: form.gamemode, map: form.map.trim() }
          : {}),
        ...(["valheim", "factorio"].includes(game.id)
          ? { serverPassword: form.serverPassword }
          : {}),
        ...(["valheim", "terraria", "factorio"].includes(game.id) &&
        form.worldName.trim()
          ? { worldName: form.worldName.trim() }
          : {}),
        ...(game.id === "squad"
          ? {
              queryPort: Number(form.queryPort || 27165),
              beaconPort: Number(form.beaconPort || 15000),
            }
          : {}),
      };
      if (modpack) {
        payload.modpackId = form.modpackId;
        payload.modpackVersion = form.modpackVersion;
      }
      await api("/profiles", { method: "POST", body: payload });
      await onCreated();
    } catch (e) {
      if (e.status === 401) onUnauthorized();
      else setError(e.message);
    } finally {
      submitLock.current = false;
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
                className={`game-select ${game?.id === item.id ? "selected" : ""} ${item.available === false ? "unavailable" : ""}`}
                key={item.id}
                onClick={() => selectGame(item)}
                disabled={item.available === false}
                title={item.unavailableReason}
              >
                <GameArt game={item.id} compact />
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  {item.available === false && (
                    <p className="game-unavailable-reason">
                      <LockKeyhole size={12} />{" "}
                      {item.unavailableReason ||
                        "Auf diesem Host nicht verfügbar."}
                    </p>
                  )}
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
              disabled={!game || game.available === false}
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
              <GameBadge game={game?.id} size={20} />
              <strong>{game?.name}</strong>
              <button
                className="text-button"
                type="button"
                onClick={() => setStep(1)}
              >
                Ändern
              </button>
            </div>
            {game?.notice && (
              <div className="inline-note game-notice">
                <CircleHelp size={17} />
                <span>{game.notice}</span>
              </div>
            )}
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
                    : `z. B. ${game?.name} mit Freunden`
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
                              Der Profil-RAM umfasst Java-Heap und native
                              Laufzeit. Mindestens 2 GB bleiben außerhalb des
                              Heaps.
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
            ) : game?.id === "gmod" ? (
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
            ) : null}
            {["valheim", "terraria", "factorio"].includes(game?.id) && (
              <>
                {["terraria", "factorio"].includes(game.id) && (
                  <p className="console-help game-version-note">
                    Native {gameName(game.id)}-Serverversion:{" "}
                    <strong>{defaultGameVersion(game)}</strong>
                  </p>
                )}
                <label>
                  Weltname <span className="optional">optional</span>
                  <input
                    maxLength={40}
                    pattern={"[A-Za-z0-9_\\-]{1,40}"}
                    value={form.worldName}
                    onChange={(event) =>
                      update("worldName", event.target.value)
                    }
                    placeholder="z. B. Feierabend_Welt"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <small>
                    Bis zu 40 Buchstaben (A–Z), Zahlen, Unterstriche oder
                    Bindestriche. Leer lassen für den Standardnamen.
                  </small>
                </label>
                {["valheim", "factorio"].includes(game.id) && (
                  <label>
                    Serverpasswort
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={64}
                      pattern={"[A-Za-z0-9_\\-]{8,64}"}
                      autoComplete="new-password"
                      value={form.serverPassword}
                      onChange={(event) =>
                        update("serverPassword", event.target.value)
                      }
                      placeholder="Passwort für den Spielbeitritt"
                      spellCheck={false}
                    />
                    <small>
                      8–64 Buchstaben, Zahlen, Unterstriche oder Bindestriche.
                      Dieses Passwort wird nach dem Anlegen nicht im Panel
                      angezeigt.
                    </small>
                    {game.id === "factorio" && (
                      <small>
                        Beitritt direkt über die Server-IP mit diesem Passwort.
                        Die Prüfung des Factorio-Spielkontos bleibt aktiviert.
                      </small>
                    )}
                  </label>
                )}
              </>
            )}
            {game?.id === "squad" && (
              <div className="form-row">
                <label>
                  Query-Port <span className="optional">optional</span>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={form.queryPort}
                    onChange={(event) =>
                      update("queryPort", event.target.value)
                    }
                    placeholder="27165"
                  />
                </label>
                <label>
                  Beacon-Port <span className="optional">optional</span>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={form.beaconPort}
                    onChange={(event) =>
                      update("beaconPort", event.target.value)
                    }
                    placeholder="15000"
                  />
                </label>
              </div>
            )}
            <div className="resource-section">
              {memoryMin > memoryMax && (
                <p className="console-help console-disabled" role="status">
                  Dieses Spiel benötigt mindestens {ram(memoryMin)} Profil-RAM.
                  Auf diesem Host stehen nach der Systemreserve {ram(memoryMax)}{" "}
                  zur Verfügung.
                </p>
              )}
              <div className="label-line">
                <strong>Arbeitsspeicher</strong>
                <span className="ram-value">{ram(form.memoryMb)}</span>
              </div>
              <input
                type="range"
                aria-label="Arbeitsspeicher in MB"
                min={memoryMin}
                max={memoryMax}
                step="512"
                value={form.memoryMb}
                onChange={(e) => update("memoryMb", Number(e.target.value))}
              />
              <div className="range-labels">
                <span>{ram(memoryMin)}</span>
                <span>{ram(memoryReserve)} bleiben für System &amp; Panel</span>
                <span>{ram(memoryMax)}</span>
              </div>
              {ftb && (
                <p className="resource-note">
                  Neue FTB-Profile erhalten standardmäßig{" "}
                  {ram(Math.min(12288, memoryMax))} Profil-RAM. Der Java-Heap
                  berücksichtigt die Empfehlung des Modpacks; zusätzlicher RAM
                  bleibt für native Speicherbereiche und den Startvorgang frei.
                </p>
              )}
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
                  max={game?.maxPlayers || 128}
                  value={form.maxPlayers}
                  onChange={(e) => update("maxPlayers", e.target.value)}
                />
                {game?.id === "squad" && (
                  <small>
                    Bis zu 100 Plätze sind die Obergrenze der Vorlage. Die
                    VPS-Ressourcen garantieren keine Leistung für 100
                    gleichzeitige Spieler.
                  </small>
                )}
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
                game?.available === false ||
                memoryMin > memoryMax ||
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
