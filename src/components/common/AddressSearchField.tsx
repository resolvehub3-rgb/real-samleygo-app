import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';

import { loadGooglePlaces } from '../../lib/googleMaps';
import { LatLng, geocodeAddress, searchAddresses } from '../../lib/routing';

/**
 * The controlled address box: text in, a realtime suggestion list as the
 * customer types, and either nothing (free typing) or a REAL picked point +
 * readable address out. It mirrors the search half of `DeliveryLocationPicker`
 * but stays small and self-contained — no map, no pin.
 *
 * Used by the Errands booking flow (pickup and destination) and by the home
 * screen's delivery address, so both type against the same providers: Google
 * Places when the key allows it, OpenStreetMap underneath, and `geocodeAddress`
 * only when a chosen place hands back no geometry of its own.
 *
 * Free typing NEVER invents coordinates: the page owns the point, and a point
 * only ever comes from a suggestion the customer selected — so a half-typed
 * address can never be priced against a guess.
 *
 * `searchLabel` adds a visible button in the field. Typing still searches on
 * its own (debounced) — the button is for the customer who would rather type
 * everything and press one control: it runs the search immediately instead of
 * waiting out the debounce, then picks the single match or shows the list.
 */

/** One row of the suggestion drop-down. */
type FieldSuggestion =
  | { id: string; mainText: string; secondaryText: string; source: 'OSM'; point: LatLng }
  | {
      id: string;
      mainText: string;
      secondaryText: string;
      source: 'GOOGLE';
      place: google.maps.places.Place;
    };

export interface AddressSearchFieldProps {
  /** Visible field label ("Pickup", "Destination"). */
  label: string;
  /** The text in the box — owned by the page. */
  value: string;
  /** Every keystroke. Updates text only, never a point. */
  onChange: (text: string) => void;
  /** A suggestion was selected: point and readable address travel together. */
  onPick: (picked: { point: LatLng; address: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Show a visible "Search" button inside the field (and let Enter run it).
   * Leave it off for flows that only ever pick from the typed suggestions.
   */
  searchLabel?: string;
}

/** Prefer Ghana, but never hide a place Nominatim only knows by its wider name. */
const GHANA_BOUNDS: google.maps.LatLngBoundsLiteral = {
  north: 11.5,
  east: 1.4,
  south: 4.8,
  west: -3.4,
};
const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;
/** Keep the drop-down open long enough for a mousedown to land on a row. */
const BLUR_CLOSE_MS = 150;

/** `LatLng`, `LatLngAltitude` and their literals all arrive here. */
const toLatLng = (value: unknown): LatLng | null => {
  if (!value) return null;
  const raw = value as { lat: number | (() => number); lng: number | (() => number) };
  const lat = typeof raw.lat === 'function' ? raw.lat() : raw.lat;
  const lng = typeof raw.lng === 'function' ? raw.lng() : raw.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export const AddressSearchField: React.FC<AddressSearchFieldProps> = ({
  label,
  value,
  onChange,
  onPick,
  placeholder,
  disabled = false,
  searchLabel,
}) => {
  const fieldId = useId();
  const listId = `${fieldId}-suggestions`;

  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // The list callbacks are read from handlers so an in-flight search always
  // resolves to the newest props, even after a re-render. `value` rides along
  // for the same reason: the Search button must search what is in the box
  // *now*, not what was there when the callback was first built.
  const handlersRef = useRef({ onChange, onPick, value });
  handlersRef.current = { onChange, onPick, value };

  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
      searchSeqRef.current++; // any in-flight reply is now stale
    },
    []
  );

  // ── Address search (Google Places when the key allows it, OSM otherwise) ──

  const searchNow = useCallback(async (text: string): Promise<FieldSuggestion[]> => {
    const places = await loadGooglePlaces();
    if (places?.AutocompleteSuggestion) {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new places.AutocompleteSessionToken();
        }
        const { suggestions: rows } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: text,
            sessionToken: sessionTokenRef.current,
            locationBias: GHANA_BOUNDS,
          });

        const mapped: FieldSuggestion[] = [];
        for (const row of rows.slice(0, 6)) {
          const prediction = row.placePrediction;
          if (!prediction) continue;
          const place = prediction.toPlace();
          mapped.push({
            id: place.id || `${text}:${mapped.length}`,
            mainText: prediction.mainText?.toString() ?? text,
            secondaryText: prediction.secondaryText?.toString() ?? '',
            source: 'GOOGLE',
            place,
          });
        }
        if (mapped.length > 0) return mapped;
      } catch {
        // Places is not enabled for this key — the keyless lookup takes over.
      }
    }

    const results = await searchAddresses(text);
    return results.map((row) => ({ ...row, source: 'OSM' as const }));
  }, []);

  const handleChange = (text: string) => {
    handlersRef.current.onChange(text);
    setHighlight(-1);

    const seq = ++searchSeqRef.current;
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);

    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      setListOpen(false);
      return;
    }

    setListOpen(true);
    setSearching(true);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      void (async () => {
        const rows = await searchNow(trimmed);
        if (seq !== searchSeqRef.current) return; // a newer keystroke won
        setSuggestions(rows);
        setSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectSuggestion = useCallback(async (row: FieldSuggestion) => {
    searchSeqRef.current++; // an in-flight list must not overwrite this choice
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    setListOpen(false);
    setSuggestions([]);
    setHighlight(-1);

    const label = [row.mainText, row.secondaryText].filter(Boolean).join(', ');

    if (row.source === 'OSM') {
      handlersRef.current.onPick({ point: row.point, address: label });
      return;
    }

    // One details call per selection, inside the autocomplete session.
    try {
      const { place } = await row.place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const formatted = place.formattedAddress || place.displayName || row.mainText;
      const geometry = toLatLng(place.location);
      if (geometry) {
        handlersRef.current.onPick({ point: geometry, address: formatted });
        sessionTokenRef.current = null; // the session ends with the details call
        return;
      }
      const resolved = await geocodeAddress(formatted); // no geometry back: ask the text
      if (resolved) handlersRef.current.onPick({ point: resolved, address: formatted });
    } catch {
      const resolved = await geocodeAddress(label);
      if (resolved) handlersRef.current.onPick({ point: resolved, address: label });
    }
  }, []);

  /**
   * The Search button (and Enter, whenever that button is shown): search NOW
   * instead of waiting out the debounce, then choose. An open list means the
   * customer already has candidates — the highlighted row wins. Exactly one
   * match is taken as the answer; several are shown so they can pick; none
   * leaves the honest "no matches" status rather than a fabricated place.
   */
  const handleSubmit = useCallback(() => {
    const text = handlersRef.current.value.trim();
    if (!text) return;

    if (listOpen && suggestions.length > 0) {
      void selectSuggestion(suggestions[highlight >= 0 ? highlight : 0]);
      return;
    }

    const seq = ++searchSeqRef.current;
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }

    setListOpen(true);
    setSearching(true);
    setSuggestions([]);
    setHighlight(-1);

    void (async () => {
      const rows = await searchNow(text);
      if (seq !== searchSeqRef.current) return; // a newer keystroke won
      setSuggestions(rows);
      setSearching(false);
      setHighlight(rows.length > 0 ? 0 : -1);
      if (rows.length === 1) void selectSuggestion(rows[0]);
    })();
  }, [highlight, listOpen, searchNow, selectSuggestion, suggestions]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // With a Search button, Enter IS that button: an open list picks a row,
      // anything else is searched immediately.
      if (searchLabel) {
        event.preventDefault();
        handleSubmit();
        return;
      }
      if (!listOpen || suggestions.length === 0) return; // Enter submits the form
      event.preventDefault();
      void selectSuggestion(suggestions[highlight >= 0 ? highlight : 0]);
      return;
    }

    if (!listOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Escape') {
      setListOpen(false);
    }
  };

  const showList = listOpen && suggestions.length > 0;
  const showStatus = listOpen && !showList;

  return (
    <div className="relative">
      <label
        htmlFor={fieldId}
        className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400"
      >
        {label}
      </label>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id={fieldId}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={label}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? 'Search area, street or landmark'}
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => {
              if (blurTimerRef.current !== null) {
                window.clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              if (suggestions.length > 0) setListOpen(true);
            }}
            onBlur={() => {
              // A short delay so a mousedown on a row registers before the list closes.
              if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
              blurTimerRef.current = window.setTimeout(() => setListOpen(false), BLUR_CLOSE_MS);
            }}
            onKeyDown={handleKeyDown}
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-[13px] font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-60"
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand"
              aria-hidden="true"
            />
          )}
        </div>

        {searchLabel && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || value.trim().length === 0}
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-bold text-white transition hover:bg-brand-dark active:scale-[0.97] disabled:opacity-50"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {searchLabel}
          </button>
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {suggestions.map((row, index) => (
            <li key={row.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()} // keep focus in the box
                onClick={() => void selectSuggestion(row)}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-b-0 ${
                  index === highlight ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">
                    {row.mainText}
                  </span>
                  {row.secondaryText && (
                    <span className="block truncate text-[10px] text-slate-400">
                      {row.secondaryText}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showStatus && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-400 shadow-lg">
          {searching ? 'Searching…' : 'No matches — keep typing or pick a suggestion'}
        </div>
      )}
    </div>
  );
};

export default AddressSearchField;
