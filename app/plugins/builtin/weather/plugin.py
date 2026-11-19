"""Plugin embutido: Clima (previsão do tempo do open-meteo.com, grátis e sem conta).

Uma thread busca a previsão da cidade configurada a cada 'refresh' minutos e publica os valores
weather.* (ver "values" no plugin.json), que as teclas e o painel "Clima agora" mostram.
  1. geocodifica o nome da cidade (só quando a cidade ou o idioma mudam);
  2. busca o tempo atual + 4 dias (hoje e os 3 seguintes).
Sem internet, tenta de novo em 1 minuto e mantém os últimos valores.
"""

from __future__ import annotations

import datetime
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from app import i18n, logs

log = logs.get("plugins.weather")
PROBLEM = "plugin.weather.fetch"
FAILS_FOR_PROBLEM = 3  # falhas seguidas até virar um problema em aberto
SLOW_MS = 5000  # pedido mais lento que isso: aviso
GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "D6Deck/1.0"
TIMEOUT = 15
RETRY = 60  # segundos, depois de um erro de rede
MIN_REFRESH, MAX_REFRESH = 5, 24 * 60
DEFAULTS = {"city": "", "refresh": 15}

# código WMO -> (chave do texto em locales/, ícone Lucide de dia, ícone de noite)
_WMO = {}
for _codes, _key, _day, _night in (
    ((0,), "clear", "sun", "moon"),
    ((1,), "mainly_clear", "sun", "moon"),
    ((2,), "partly_cloudy", "cloud-sun", "cloud-moon"),
    ((3,), "overcast", "cloud", "cloud"),
    ((45, 48), "fog", "cloud-fog", "cloud-fog"),
    ((51, 53, 55), "drizzle", "cloud-drizzle", "cloud-drizzle"),
    ((56, 57), "freezing_drizzle", "cloud-drizzle", "cloud-drizzle"),
    ((61,), "light_rain", "cloud-rain", "cloud-rain"),
    ((63,), "rain", "cloud-rain", "cloud-rain"),
    ((65,), "heavy_rain", "cloud-rain", "cloud-rain"),
    ((66, 67), "freezing_rain", "cloud-rain", "cloud-rain"),
    ((71, 73, 75, 77), "snow", "cloud-snow", "cloud-snow"),
    ((80, 81), "showers", "cloud-rain", "cloud-rain"),
    ((82,), "heavy_showers", "cloud-rain", "cloud-rain"),
    ((85, 86), "snow_showers", "cloud-snow", "cloud-snow"),
    ((95,), "thunderstorm", "cloud-lightning", "cloud-lightning"),
    ((96, 99), "hail", "cloud-lightning", "cloud-lightning"),
):
    for _c in _codes:
        _WMO[_c] = (_key, _day, _night)


def wmo(code, is_day=True) -> tuple[str, str]:
    """(chave do texto, ícone Lucide) para um código WMO."""
    try:
        key, day, night = _WMO[int(code)]
    except (KeyError, TypeError, ValueError):
        return "unknown", "cloud"
    return key, day if is_day else night


def _int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


class NotFound(Exception):
    pass


class _Plugin:
    def __init__(self, api):
        self.api = api
        self.settings = dict(DEFAULTS)
        self._texts = self._read_locales()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._place: dict | None = None  # {"key": (cidade, idioma), "lat", "lon", "name"}
        self._data: dict | None = None  # última resposta da previsão
        self._status = ("wait", "status.wait", {}, None)
        self._fails = 0  # buscas que falharam seguidas

    # -- textos do próprio plugin (locales/<idioma>.json)
    @staticmethod
    def _read_locales() -> dict[str, dict]:
        out = {}
        for f in (Path(__file__).parent / "locales").glob("*.json"):
            try:
                out[f.stem] = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                log.warning("Couldn't read locales/%s: %s", f.name, e)
        return out

    def t(self, key: str, **kw) -> str:
        lang = i18n.language()
        for code in (lang, lang.split("-")[0], "en"):
            table = self._texts.get(code)
            if table and key in table:
                text = table[key]
                return text.format(**kw) if kw else text
        return key

    # -- ciclo de vida
    def start(self, settings: dict) -> None:
        self.update(settings)
        if self._thread is None or not self._thread.is_alive() or self._stop.is_set():
            self._stop = threading.Event()
            self._thread = threading.Thread(target=self._run, args=(self._stop,), name="weather", daemon=True)
            self._thread.start()

    def update(self, settings: dict) -> None:
        new = {**DEFAULTS, **{k: v for k, v in (settings or {}).items() if v is not None}}
        with self._lock:
            changed = new != self.settings
            self.settings = new
        if changed:
            self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._fails = 0
        logs.resolve(PROBLEM)
        if self._thread is not None:
            self._thread.join(timeout=1.0)  # se estiver no meio de um pedido, termina sozinha (daemon)
        self._thread = None

    def set_locale(self, lang: str) -> None:
        """O idioma mudou: republica os textos (condição, dias) sem ir à internet."""
        if self._data is not None:
            self._publish(self._data)

    def current_status(self) -> dict:
        state, key, kw, detail = self._status
        out = {"state": state, "label": self.t(key, **kw)}
        if detail:
            out["detail"] = detail
        return out

    # -- thread
    def _run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            self._wake.clear()
            with self._lock:
                city = str(self.settings.get("city") or "").strip()
                refresh = self.settings.get("refresh")
            try:
                minutes = min(MAX_REFRESH, max(MIN_REFRESH, float(refresh)))
            except (TypeError, ValueError):
                minutes = DEFAULTS["refresh"]
            wait = None  # sem cidade: só acorda quando o config mudar
            if not city:
                self._status = ("wait", "status.wait", {}, None)
                self._place = self._data = None
                self._fails = 0
                logs.resolve(PROBLEM)
            else:
                wait = self._cycle(city, stop, minutes * 60)
            if stop.is_set():
                break
            self._wake.wait(wait)

    def _cycle(self, city: str, stop: threading.Event, every: float) -> float | None:
        """Uma busca. Devolve quantos segundos esperar até a próxima (None: até o config mudar)."""
        lang = "pt" if i18n.language().startswith("pt") else "en"
        t0 = time.monotonic()
        try:
            if self._place is None or self._place["key"] != (city, lang):
                if self._data is None:
                    self._status = ("wait", "status.loading", {}, None)
                self._place = self._geocode(city, lang)
                log.debug(
                    "City '%s' -> %s (%.2f, %.2f)", city, self._place["name"], self._place["lat"], self._place["lon"]
                )
            data = self._forecast(self._place["lat"], self._place["lon"])
        except NotFound:
            self._place = self._data = None
            self._status = ("error", "status.not_found", {}, f"open-meteo geocoding: no results for '{city}'")
            log.warning("City not found: '%s'", city)
            logs.problem(PROBLEM, "The weather city wasn't found: {city}", "integrations:weather", city=city)
            self._clear()
            return None
        except (urllib.error.HTTPError, ValueError, KeyError, TypeError, IndexError) as e:
            self._status = ("error", "status.service", {}, f"{type(e).__name__}: {e}")
            self._failed(
                "The weather service isn't answering correctly", e, exc_info=not isinstance(e, urllib.error.HTTPError)
            )
            return RETRY
        except (urllib.error.URLError, OSError) as e:  # sem rede, DNS, tempo esgotado
            self._status = ("error", "status.offline", {}, f"{type(e).__name__}: {getattr(e, 'reason', e)}")
            self._failed("The weather can't be updated: no connection to the weather service", e)
            return RETRY
        if stop.is_set():
            return None
        ms = round((time.monotonic() - t0) * 1000)
        if ms > SLOW_MS:
            log.warning("The weather service is slow: %d ms", ms)
        if self._fails:
            log.info("Weather updated again after %d failed attempts", self._fails)
        self._fails = 0
        logs.resolve(PROBLEM)
        self._data = data
        self._publish(data)
        self._status = ("ok", "status.ok", {"time": time.strftime("%H:%M")}, None)
        log.debug("Weather updated for %s in %d ms; next in %.0f min", (self._place or {}).get("name"), ms, every / 60)
        return every

    def _failed(self, text: str, e: Exception, exc_info: bool = False) -> None:
        """Uma busca falhou: aviso no log e, depois de algumas seguidas, um problema em aberto."""
        self._fails += 1
        reason = f"{type(e).__name__}: {getattr(e, 'reason', e)}"
        log.warning(
            "Weather fetch failed (%d in a row): %s; retrying in %d s", self._fails, reason, RETRY, exc_info=exc_info
        )
        if self._fails >= FAILS_FOR_PROBLEM:
            logs.problem(PROBLEM, text, "integrations:weather")

    @staticmethod
    def _get(url: str, params: dict) -> dict:
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))

    def _geocode(self, city: str, lang: str) -> dict:
        got = self._get(GEO_URL, {"name": city, "count": 1, "language": lang, "format": "json"})
        results = got.get("results") or []
        if not results:
            # "Campinas, SP" / "Porto, Portugal": a API só entende o nome; tenta a parte antes da vírgula
            head = city.split(",")[0].strip()
            if head and head != city:
                got = self._get(GEO_URL, {"name": head, "count": 1, "language": lang, "format": "json"})
                results = got.get("results") or []
        if not results:
            raise NotFound(city)
        r = results[0]
        return {
            "key": (city, lang),
            "lat": float(r["latitude"]),
            "lon": float(r["longitude"]),
            "name": r.get("name") or city,
        }

    def _forecast(self, lat: float, lon: float) -> dict:
        data = self._get(
            FORECAST_URL,
            {
                "latitude": f"{lat:.4f}",
                "longitude": f"{lon:.4f}",
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "timezone": "auto",
                "forecast_days": 4,
            },
        )
        if "current" not in data or "daily" not in data:
            raise ValueError(data.get("reason") or "response without 'current'/'daily'")
        return data

    # -- valores
    def _set(self, name: str, value) -> None:
        fn = getattr(self.api, "set_value", None)
        if fn is not None:
            try:
                fn(name, value)
            except Exception as e:
                log.warning("Couldn't publish %s: %s", name, e, exc_info=True)

    def _clear(self) -> None:
        for name in ("temp", "max", "min", "condition", "condition_short", "icon", "wind", "rain", "humidity", "city"):
            self._set(f"weather.{name}", None)
        for d in (1, 2, 3):
            for part in ("name", "max", "min", "icon"):
                self._set(f"weather.d{d}.{part}", None)

    def _publish(self, data: dict) -> None:
        cur, daily = data["current"], data["daily"]

        def day(field, i):
            seq = daily.get(field) or []
            return seq[i] if i < len(seq) else None

        key, icon = wmo(cur.get("weather_code"), cur.get("is_day", 1) != 0)
        self._set("weather.temp", _int(cur.get("temperature_2m")))
        self._set("weather.max", _int(day("temperature_2m_max", 0)))
        self._set("weather.min", _int(day("temperature_2m_min", 0)))
        self._set("weather.condition", self.t(f"wmo.{key}"))
        self._set("weather.condition_short", self.t(f"wmo_short.{key}"))  # cabe numa linha da tecla
        self._set("weather.icon", icon)
        self._set("weather.wind", _int(cur.get("wind_speed_10m")))
        self._set("weather.rain", _int(day("precipitation_probability_max", 0)))
        self._set("weather.humidity", _int(cur.get("relative_humidity_2m")))
        self._set("weather.city", (self._place or {}).get("name"))
        for d in (1, 2, 3):
            try:
                name = self.t(f"weekday.{datetime.date.fromisoformat(day('time', d)).weekday()}")
            except (TypeError, ValueError):
                name = None
            self._set(f"weather.d{d}.name", name)
            self._set(f"weather.d{d}.max", _int(day("temperature_2m_max", d)))
            self._set(f"weather.d{d}.min", _int(day("temperature_2m_min", d)))
            self._set(f"weather.d{d}.icon", wmo(day("weather_code", d))[1])


def setup(api):
    return _Plugin(api)
