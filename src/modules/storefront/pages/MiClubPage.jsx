import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchCuentaResumen } from "../cuentaApi.js";

const CLUB_RAFFLE_IMAGE_KEY = "licoreria_club_raffle_image";

const LEVELS = [
  { key: "VECINO", label: "Vecino", min: 0, next: 300, range: "0 - 299 pts", icon: "★", color: "#b86d35", note: "Empiezas tu camino" },
  { key: "CASERO", label: "Casero", min: 300, next: 700, range: "300 - 699 pts", icon: "✪", color: "#a6a6a6", note: "Vas por buen camino" },
  { key: "PATA", label: "Pata de la Casa", min: 700, next: 1500, range: "700 - 1,499 pts", icon: "★", color: "#f0b51a", note: "Ya eres de los nuestros" },
  { key: "LEYENDA", label: "Leyenda de la Previa", min: 1500, next: null, range: "1,500+ pts", icon: "♛", color: "#9a59d1", note: "Eres leyenda" }
];

const DEFAULT_MISSIONS = [
  { name: "Primera noche", description: "Haz tu primer pedido del mes", rewardTickets: 1, icon: "🍺", completed: false },
  { name: "Segunda ronda", description: "Realiza dos pedidos en el mes", rewardTickets: 2, icon: "🥂", completed: false },
  { name: "Cliente frecuente", description: "Realiza tres pedidos en el mes", rewardTickets: 3, icon: "🍻", completed: false },
  { name: "Primer Combo", description: "Compra tu primer combo del mes", rewardTickets: 2, icon: "🍾", completed: false }
];

const CLUB_MISSION_GROUPS = [
  {
    title: "Misiones unicas",
    subtitle: "1 vez por mes",
    missions: [
      { name: "Primera Noche", description: "Haz tu primer pedido del mes.", rewardTickets: 1, icon: "🍺" },
      { name: "Segunda Ronda", description: "Realiza 2 pedidos durante el mes.", rewardTickets: 2, icon: "🍻" },
      { name: "Cliente Frecuente", description: "Realiza 3 pedidos durante el mes.", rewardTickets: 3, icon: "🎉" },
      { name: "Primer Combo", description: "Compra tu primer combo del mes.", rewardTickets: 2, icon: "🍾" },
      { name: "Noche Completa", description: "Acumula S/100 en compras durante el mes.", rewardTickets: 5, icon: "🌙" }
    ]
  },
  {
    title: "Misiones repetibles",
    subtitle: "Puedes completarlas varias veces",
    missions: [
      { name: "No te olvides el hielo", description: "Agrega hielo a cualquier pedido.", rewardTickets: 1, limit: "Limite: 5 veces al mes", icon: "🧊" },
      { name: "Mix Perfecto", description: "Agrega cualquier mixer o gaseosa.", rewardTickets: 1, limit: "Limite: 5 veces al mes", icon: "🥤" },
      { name: "Producto Destacado", description: "Compra un producto marcado por la licoreria como destacado.", rewardTickets: 2, limit: "Limite: 3 veces al mes", icon: "⭐" },
      { name: "Dale una oportunidad", description: "Compra un producto de baja rotacion seleccionado por la licoreria.", rewardTickets: 3, limit: "Limite: 2 veces al mes", icon: "🍷" },
      { name: "Whisky Night", description: "Compra cualquier whisky.", rewardTickets: 2, limit: "Limite: 3 veces al mes", icon: "🥃" },
      { name: "Ron Lover", description: "Compra cualquier ron.", rewardTickets: 2, limit: "Limite: 3 veces al mes", icon: "🏴" },
      { name: "Energia Extra", description: "Compra cualquier energizante.", rewardTickets: 1, limit: "Limite: 5 veces al mes", icon: "⚡" },
      { name: "Combo de la Semana", description: "Compra el combo promocionado de la semana.", rewardTickets: 3, limit: "Limite: Sin limite", icon: "🎁" }
    ]
  }
];

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

function buildFallbackCuenta(user) {
  return {
    user: user || {},
    club: {
      nivel: "Vecino",
      color: "#b86d35",
      puntos: 0,
      boletos: 0,
      progreso: 0,
      objetivo: 300,
      siguiente: "Casero",
      faltante: 300,
      missions: DEFAULT_MISSIONS,
      levels: LEVELS.map((level) => ({ name: level.label, range: level.range, color: level.color })),
      monthlyPrize: "Gift Card Delivery S/25",
      prizeUsage: "Credito aplicable unicamente al delivery. Valido para usar en tus pedidos durante el siguiente mes.",
      previousWinnerName: "Carlos M.",
      ...getMonthMeta()
    },
    beneficios: [],
    invitacion: { descuentoAmigo: 10, premioPuntos: 300 }
  };
}

function getFriendlyLevel(level) {
  const normalized = String(level || "").toUpperCase();
  if (normalized === "BRONCE") return LEVELS[0];
  if (normalized === "PLATA") return LEVELS[1];
  if (normalized === "ORO") return LEVELS[2];
  return LEVELS.find((item) => item.key === normalized || item.label.toUpperCase() === normalized) || null;
}

function getLevelByPoints(points) {
  const safe = Number(points || 0);
  if (safe < 300) return LEVELS[0];
  if (safe < 700) return LEVELS[1];
  if (safe < 1500) return LEVELS[2];
  return LEVELS[3];
}

function getMonthMeta(date = new Date()) {
  const monthIndex = date.getMonth();
  const year = date.getFullYear();
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const previousMonth = new Date(year, monthIndex - 1, 1);
  return {
    currentMonth: MONTHS[monthIndex],
    currentYear: year,
    nextMonth: MONTHS[(monthIndex + 1) % 12],
    previousWinnerMonth: `${MONTHS[previousMonth.getMonth()]} ${previousMonth.getFullYear()}`,
    daysUntilRaffle: Math.max(1, Math.ceil((nextMonth.getTime() - date.getTime()) / 86400000))
  };
}

export default function MiClubPage({ user: sessionUser, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [raffleImage, setRaffleImage] = useState(() => {
    try {
      return localStorage.getItem(CLUB_RAFFLE_IMAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [showMissions, setShowMissions] = useState(false);
  const imageInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCuentaResumen()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        if (!cancelled) setData(buildFallbackCuenta(sessionUser));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  const club = data?.club || buildFallbackCuenta(sessionUser).club;
  const points = Number(club.puntos || 0);
  const currentLevel = getFriendlyLevel(club.nivel) || getLevelByPoints(points);
  const nextLevel = LEVELS[LEVELS.findIndex((level) => level.key === currentLevel.key) + 1] || currentLevel;
  const tickets = Number(club.boletos || 0);
  const progress = Math.max(0, Math.min(100, Math.round((club.progreso || 0) * 100)));
  const objetivo = Number(club.objetivo || currentLevel.next || points || 0);
  const faltante = Number(club.faltante || 0);
  const completedMissions = Array.isArray(club.missions) && club.missions.length ? club.missions : DEFAULT_MISSIONS;
  const completedMissionNames = new Set(
    completedMissions.filter((mission) => mission.completed).map((mission) => String(mission.name || "").toLowerCase())
  );
  const missions = CLUB_MISSION_GROUPS[0].missions.slice(0, 4).map((mission) => ({
    ...mission,
    completed: completedMissionNames.has(mission.name.toLowerCase())
  }));
  const levels = Array.isArray(club.levels) && club.levels.length ? club.levels : LEVELS.map((level) => ({ name: level.label, range: level.range, color: level.color }));
  const monthMeta = {
    ...getMonthMeta(),
    currentMonth: club.currentMonth || getMonthMeta().currentMonth,
    currentYear: club.currentYear || getMonthMeta().currentYear,
    nextMonth: club.nextMonth || getMonthMeta().nextMonth,
    previousWinnerMonth: club.previousWinnerMonth || getMonthMeta().previousWinnerMonth,
    daysUntilRaffle: club.daysUntilRaffle || getMonthMeta().daysUntilRaffle
  };
  const monthlyPrize = club.monthlyPrize || "Gift Card Delivery S/25";
  const prizeUsage = club.prizeUsage || `Credito aplicable unicamente al delivery. Valido para usar en tus pedidos durante ${monthMeta.nextMonth}.`;
  const previousWinnerName = club.previousWinnerName || "Carlos M.";
  const isAdmin = String(sessionUser?.rol || "").toLowerCase() === "admin";
  const raffleStyle = raffleImage ? { "--club-raffle-image": `url("${raffleImage}")` } : undefined;

  function handleRaffleImageChange(event) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      setRaffleImage(value);
      try {
        localStorage.setItem(CLUB_RAFFLE_IMAGE_KEY, value);
      } catch {}
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  if (loading) {
    return (
      <section className="page-shell club-page">
        <div className="page-loading-icon club-loading" role="status" aria-label="Cargando club">
          <span aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell club-page">
      <header className="club-hero-head">
        <button type="button" className="club-back" onClick={() => onNavigate?.("cuenta")} aria-label="Volver a mi perfil">‹</button>
        <div>
          <span aria-hidden="true" className="club-crown">♛</span>
          <p>Club</p>
          <h1>La Licoreria</h1>
          <small>Completa metas, suma boletos y participa por delivery gratis cada mes.</small>
        </div>
        <button type="button" className="club-help" title="Proximamente" aria-label="Como funciona">?</button>
      </header>

      <div className="club-content-frame">
        <section className={`club-raffle-card club-raffle-card-v2${raffleImage ? " has-custom-image" : ""}`} style={raffleStyle}>
          {isAdmin ? (
            <>
              <button type="button" className="club-admin-image-button" onClick={() => imageInputRef.current?.click()}>
                Cambiar imagen
              </button>
              <input
                ref={imageInputRef}
                className="club-admin-image-input"
                type="file"
                accept="image/*"
                onChange={handleRaffleImageChange}
              />
            </>
          ) : null}
          <span className="club-raffle-badge">Sorteo activo</span>
          <div className="club-raffle-stage">
            <div className="club-raffle-tickets">
              <p>Tus boletos</p>
              <strong>{tickets}</strong>
              <span>Participaciones acumuladas</span>
              <small>Quedan {monthMeta.daysUntilRaffle} dias para el sorteo</small>
            </div>
          </div>
        </section>

        <div className="club-grid">
          <article className="club-winner-card">
            <p className="club-section-kicker">Ganador {monthMeta.previousWinnerMonth}</p>
            <div className="club-winner-avatar" aria-hidden="true">🏆</div>
            <h3>{previousWinnerName}</h3>
            <p>Gano:</p>
            <strong>Gift Card Delivery S/25</strong>
            <span>Felicitaciones</span>
          </article>

          <article className="club-missions-card">
            <header>
              <h3>Como consigo mas boletos?</h3>
            </header>
            <ul>
              {missions.map((mission) => (
                <li key={mission.name}>
                  <span className={`club-mission-check${mission.completed ? " is-done" : ""}`} aria-hidden="true">{mission.completed ? "✓" : ""}</span>
                  <span className="club-mission-icon" aria-hidden="true">{mission.icon}</span>
                  <span>
                    <strong>{mission.name}</strong>
                    <small>{mission.description}</small>
                  </span>
                  <b>+{mission.rewardTickets} {mission.rewardTickets === 1 ? "boleto" : "boletos"}</b>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setShowMissions(true)}>Ver todas las misiones <span aria-hidden="true">›</span></button>
          </article>
        </div>

        <section className="club-level-card">
          <div className="club-current-level">
            <p className="club-section-kicker">Mi nivel actual</p>
            <div className="club-medal" style={{ "--club-level-color": currentLevel.color }} aria-hidden="true">{currentLevel.icon}</div>
            <h3>{currentLevel.label}</h3>
            <p><strong>{points}</strong> / {objetivo} pts</p>
            <div className="club-level-progress" aria-label={`${progress}% del camino recorrido`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <small>{progress}% del camino recorrido</small>
          </div>
          <div className="club-next-level">
            <p>Te faltan</p>
            <strong>{faltante}<span>pts</span></strong>
            <p>para llegar a</p>
            <h3>{nextLevel.label}</h3>
          </div>
          <div className="club-level-encourage">
            <span aria-hidden="true">🍾</span>
            <strong>Sigue asi!</strong>
            <p>Cada pedido te acerca mas.</p>
          </div>
        </section>

        <section className="club-levels-card">
          <h3>Todos los niveles del club</h3>
          <div className="club-levels-grid">
            {levels.map((level) => {
              const meta = getFriendlyLevel(level.name) || LEVELS.find((item) => item.label === level.name) || LEVELS[0];
              return (
              <article key={level.name} className={level.name === currentLevel.label ? "is-active" : ""}>
                <div className="club-medal" style={{ "--club-level-color": level.color || meta.color }} aria-hidden="true">{meta.icon}</div>
                <strong>{level.name}</strong>
                <span>{level.range}</span>
                <small>{level.note || meta.note}</small>
              </article>
              );
            })}
          </div>
          <p className="club-reset-note">
            <span aria-hidden="true">↻</span>
            Los boletos se reinician cada mes. <strong>Cada mes es una nueva oportunidad para ganar.</strong>
          </p>
        </section>
      </div>

      {showMissions ? (
        <div className="club-missions-modal-backdrop" role="presentation" onMouseDown={() => setShowMissions(false)}>
          <section
            className="club-missions-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="club-missions-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="club-missions-modal-head">
              <div>
                <p>Club La Licoreria</p>
                <h2 id="club-missions-modal-title">Misiones Mes 1</h2>
              </div>
              <button type="button" onClick={() => setShowMissions(false)} aria-label="Cerrar misiones">×</button>
            </header>
            <div className="club-missions-modal-body">
              {CLUB_MISSION_GROUPS.map((group) => (
                <article key={group.title} className="club-missions-group">
                  <header>
                    <h3>{group.title}</h3>
                    <span>{group.subtitle}</span>
                  </header>
                  <ul>
                    {group.missions.map((mission) => (
                      <li key={mission.name}>
                        <span className="club-mission-icon" aria-hidden="true">{mission.icon}</span>
                        <span className="club-mission-copy">
                          <strong>{mission.name}</strong>
                          <small>{mission.description}</small>
                          {mission.limit ? <em>{mission.limit}</em> : null}
                        </span>
                        <b>+{mission.rewardTickets} {mission.rewardTickets === 1 ? "boleto" : "boletos"}</b>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
