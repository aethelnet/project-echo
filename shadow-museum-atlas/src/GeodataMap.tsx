// @ts-nocheck
import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import fallbackGeodata from './geodata.json';
import { useLang, metricFilterLabel } from './i18n';

interface GeodataMapProps {
  activeMetricFilter: string | null;
  searchTerm: string;
  onSelectNode: (node: any) => void;
  onSelectLink: (link: any) => void;
  onSelectRoute: (route: any) => void;
  selectedRouteId?: string | null;
}

// Compute points along quadratic Bezier curve
function computeBezierPoints(
  start: [number, number],
  end: [number, number],
  numPoints: number = 30,
  curvatureFactor: number = 0.22
): [number, number][] {
  const [lat1, lng1] = start;
  const [lat2, lng2] = end;
  
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  
  // Normal vector pointing westward/curving
  const ctrlLat = midLat - curvatureFactor * dLng;
  const ctrlLng = midLng + curvatureFactor * dLat;
  
  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const invT = 1 - t;
    const lat = invT * invT * lat1 + 2 * invT * t * ctrlLat + t * t * lat2;
    const lng = invT * invT * lng1 + 2 * invT * t * ctrlLng + t * t * lng2;
    points.push([lat, lng]);
  }
  return points;
}

export default function GeodataMap({
  activeMetricFilter,
  searchTerm,
  onSelectNode,
  onSelectLink,
  onSelectRoute,
  selectedRouteId
}: GeodataMapProps) {
  const { lang, t } = useLang();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersGroupRef = useRef<L.LayerGroup | null>(null);
  const expeditionsGroupRef = useRef<L.LayerGroup | null>(null);

  const [geodata, setGeodata] = useState<any>(fallbackGeodata);
  const [loading, setLoading] = useState(false);
  const [showExpeditions, setShowExpeditions] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [hoveredRoute, setHoveredRoute] = useState<any | null>(null);

  // 1. Fetch live geodata from API if available
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetch('/api/geodata')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (isMounted && data && data.routes) {
          setGeodata(data);
        }
      })
      .catch(err => {
        console.warn("Using fallback local geodata:", err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return; // already initialized

    const map = L.map(mapContainerRef.current, {
      center: [28.0, 11.0], // Centered between Central Africa and Western Europe
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });

    // Free OpenStreetMap Tiles with CSS Inversion for Brutalist Dark Matter look
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'brutalist-dark-tiles'
    }).addTo(map);

    // Inject CSS for the tile inversion (forces OSM to become Dark Matter)
    if (!document.getElementById('brutalist-map-style')) {
      const style = document.createElement('style');
      style.id = 'brutalist-map-style';
      style.innerHTML = `
        .brutalist-dark-tiles {
          filter: invert(100%) hue-rotate(180deg) brightness(85%) contrast(110%);
        }
      `;
      document.head.appendChild(style);
    }

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    layersGroupRef.current = L.layerGroup().addTo(map);
    expeditionsGroupRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Filter routes and origins based on metric filter & search term
  const filteredData = useMemo(() => {
    if (!geodata) return { origins: [], depots: [], routes: [], expedition_events: [] };

    let routes = geodata.routes || [];
    let origins = geodata.origins || [];
    let depots = geodata.depots || [];
    let expeditionEvents = geodata.expedition_events || [];

    // Filter by Metric
    if (activeMetricFilter === 'raub') {
      routes = routes.filter((r: any) => !r.has_suspicion);
    } else if (activeMetricFilter === 'verdacht') {
      routes = routes.filter((r: any) => r.has_suspicion);
    } else if (activeMetricFilter === 'dissonanz') {
      routes = routes.filter((r: any) => r.has_contested);
    }

    // Filter by Search Term
    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      routes = routes.filter((r: any) => {
        const inOrigin = r.origin_name.toLowerCase().includes(q);
        const inDepot = r.depot_name.toLowerCase().includes(q) || r.depot_city.toLowerCase().includes(q);
        const inActors = r.actors.some((a: string) => a.toLowerCase().includes(q));
        const inExp = r.expeditions.some((e: string) => e.toLowerCase().includes(q));
        const inObjs = r.objects.some((o: any) => (o.inv && o.inv.toLowerCase().includes(q)) || (o.bez && o.bez.toLowerCase().includes(q)));
        return inOrigin || inDepot || inActors || inExp || inObjs;
      });
    }

    // Collect active origin IDs and depot IDs from filtered routes
    const activeOriginIds = new Set(routes.map((r: any) => r.origin_id));
    const activeDepotIds = new Set(routes.map((r: any) => r.depot_id));

    // Filter origins
    const visibleOrigins = origins.filter((o: any) => activeOriginIds.has(o.id));
    const visibleDepots = depots.filter((d: any) => activeDepotIds.has(d.id));

    return {
      origins: visibleOrigins,
      depots: visibleDepots,
      routes,
      expedition_events: expeditionEvents
    };
  }, [geodata, activeMetricFilter, searchTerm]);

  // 3. Render Vector Lines and Markers on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layersGroup = layersGroupRef.current;
    if (!map || !layersGroup) return;

    layersGroup.clearLayers();
    const tr = (en: string, de: string, fr: string) => (lang === 'de' ? de : lang === 'fr' ? fr : en);

    // 3.1 Render Restitution Vectors (Curved Arcs)
    filteredData.routes.forEach((route: any) => {
      const isSelected = selectedRouteId === route.id;
      const points = computeBezierPoints(route.origin_coords, route.depot_coords, 32, 0.25);

      // Color coding
      let strokeColor = '#DC2626'; // Red for military looting
      if (route.has_suspicion) strokeColor = '#0891B2'; // Cyan for probabilistic suspicion
      else if (route.has_contested) strokeColor = '#CA8A04'; // Gold for contested dissonance

      const baseWeight = Math.max(1.8, Math.min(8, Math.log2(route.object_count + 1) * 1.5));
      const weight = isSelected ? baseWeight + 3 : baseWeight;
      const opacity = isSelected ? 1.0 : (selectedRouteId ? 0.35 : 0.75);

      const polyline = L.polyline(points, {
        color: isSelected ? '#FFFFFF' : strokeColor,
        weight: weight,
        opacity: opacity,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: route.has_suspicion ? '5, 5' : undefined
      });

      // Tooltip
      const tooltipContent = `
        <div style="font-family: 'Inter', sans-serif; font-size: 11.5px; padding: 6px 9px; background: #141413; color: #F7F6F2; border: 1px solid ${strokeColor}; border-left: 3px solid ${strokeColor};">
          <div style="font-weight: 700; color: #FFFFFF;">${route.origin_name} &rarr; ${route.depot_city}</div>
          <div style="margin-top: 3px; font-size: 10.5px;"><b>${tr('Objects', 'Kulturgüter', 'Biens culturels')}:</b> <span style="font-family:'IBM Plex Mono',ui-monospace,monospace;">${route.object_count}</span></div>
          <div style="font-size: 10px; color: #B5B3AC;"><b>${tr('Depot', 'Depot', 'Dépôt')}:</b> ${route.depot_name}</div>
          <div style="font-size: 10px; color: #E5B869;"><b>${tr('Expedition', 'Expedition', 'Expédition')}:</b> ${route.expeditions.join(', ')}</div>
          <div style="font-size: 10px; color: #D6D3CB;"><b>${tr('Actors', 'Akteure', 'Acteurs')}:</b> ${route.actors.join(', ') || tr('Unknown', 'Unbekannt', 'Inconnu')}</div>
          <div style="margin-top: 4px; font-size: 9.5px; color: #7DD3FC; font-weight: 600;">${tr('Click for forensic case file →', 'Klicken für forensische Fallakte →', 'Cliquer pour le dossier forensique →')}</div>
        </div>
      `;
      polyline.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      polyline.on('mouseover', () => {
        setHoveredRoute(route);
        polyline.setStyle({
          color: '#FFFFFF',
          weight: baseWeight + 2.5,
          opacity: 1.0
        });
      });

      polyline.on('mouseout', () => {
        setHoveredRoute(null);
        if (!isSelected) {
          polyline.setStyle({
            color: strokeColor,
            weight: baseWeight,
            opacity: opacity
          });
        }
      });

      polyline.on('click', () => {
        onSelectRoute(route);
      });

      polyline.addTo(layersGroup);
    });

    // 3.2 Render Cameroon Polities (Origins)
    filteredData.origins.forEach((orig: any) => {
      const radius = Math.max(7, Math.min(22, Math.sqrt(orig.object_count) * 2.4));
      
      let fillColor = '#DC2626';
      if (orig.suspicion_count > 0 && orig.object_count === orig.suspicion_count) {
        fillColor = '#0891B2';
      } else if (orig.contested_count > 0) {
        fillColor = '#CA8A04';
      }

      // Outer radar circle
      const outerCircle = L.circleMarker([orig.lat, orig.lng], {
        radius: radius + 4,
        fillColor: 'transparent',
        color: fillColor,
        weight: 1.5,
        opacity: 0.5,
        dashArray: '2, 3'
      });
      outerCircle.addTo(layersGroup);

      // Core marker
      const marker = L.circleMarker([orig.lat, orig.lng], {
        radius: radius,
        fillColor: fillColor,
        fillOpacity: 0.85,
        color: '#FFFFFF',
        weight: 2
      });

      const tooltipContent = `
        <div style="font-family: 'Inter', sans-serif; font-size: 11.5px; padding: 6px 9px; background: #141413; color: #F7F6F2; border: 1px solid ${fillColor}; border-left: 3px solid ${fillColor};">
          <div style="font-weight: 700; color: #FFFFFF;">${orig.name} <span style="font-size:10px;color:#B5B3AC;font-weight:500;">(${tr('Origin', 'Herkunft', 'Origine')})</span></div>
          <div style="font-size: 10px; margin-top: 2px; color: #D6D3CB;"><b>${tr('Region', 'Region', 'Région')}:</b> ${orig.region}</div>
          <div style="font-size: 10.5px; color: #FCA5A5;"><b>${tr('Looted Heritage', 'Raubkunst', 'Patrimoine pillé')}:</b> <span style="font-family:'IBM Plex Mono',ui-monospace,monospace;">${orig.object_count}</span></div>
          <div style="font-size: 10px; color: #B5B3AC;"><b>${tr('Target Depots', 'Ziel-Depots', 'Dépôts cibles')}:</b> ${orig.depot_ids.length} ${tr('museums in Europe', 'Museen in Europa', 'musées en Europe')}</div>
          <div style="font-size: 10px; color: #E5B869;"><b>${tr('Expeditions', 'Expeditionen', 'Expéditions')}:</b> ${orig.expeditions.slice(0, 3).join(', ')}</div>
          <div style="margin-top: 4px; font-size: 9.5px; color: #7DD3FC; font-weight: 600;">${tr('Click to inspect polity →', 'Klicken zum Isolieren →', 'Cliquer pour isoler →')}</div>
        </div>
      `;
      marker.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      marker.on('click', () => {
        onSelectNode({
          id: orig.id,
          label: orig.name,
          type: 'Polity',
          desc: tr(
            `${orig.region} | ${orig.object_count} looted cultural objects`,
            `${orig.region} | ${orig.object_count} geraubte Kulturgüter`,
            `${orig.region} | ${orig.object_count} biens culturels pillés`
          ),
          contested: orig.contested_count > 0,
          meta: orig
        });
      });

      marker.addTo(layersGroup);
    });

    // 3.3 Render European Museum Depots
    filteredData.depots.forEach((depot: any) => {
      // Create archival HTML badge for museum hubs
      const depotIcon = L.divIcon({
        className: 'custom-depot-pin',
        html: `
          <div style="
            background-color: rgba(20, 20, 19, 0.94);
            color: #F7F6F2;
            border: 1px solid rgba(255, 255, 255, 0.45);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
            padding: 3px 7px;
            border-radius: 2px;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 9.5px;
            font-weight: 700;
            white-space: nowrap;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            transform: translate(-50%, -50%);
          ">
            <span style="display:inline-block; width:6px; height:6px; background-color:#DC2626; border-radius:50%;"></span>
            <span>${depot.city}: ${depot.object_count.toLocaleString()}</span>
          </div>
        `,
        iconSize: [80, 24],
        iconAnchor: [40, 12]
      });

      const marker = L.marker([depot.lat, depot.lng], { icon: depotIcon });

      const tooltipContent = `
        <div style="font-family: 'Inter', sans-serif; font-size: 11.5px; padding: 7px 10px; background: #141413; color: #F7F6F2; border: 1px solid rgba(255,255,255,0.35);">
          <div style="font-weight: 700; color: #FFFFFF;">${depot.name}</div>
          <div style="font-size: 10px; margin-top: 2px; color: #B5B3AC;"><b>${tr('Location', 'Standort', 'Localisation')}:</b> ${depot.address}</div>
          <div style="font-size: 10.5px; color: #FCA5A5; font-weight: 600;"><b>${tr('Recorded Objects', 'Kulturgüter', 'Biens culturels')}:</b> <span style="font-family:'IBM Plex Mono',ui-monospace,monospace;">${depot.object_count.toLocaleString()}</span></div>
          <div style="font-size: 10px; color: #B5B3AC;"><b>${tr('Origin Polities', 'Herkunftsorte', "Polities d'origine")}:</b> ${depot.origin_ids.length} ${tr('districts', 'Distrikte', 'districts')}</div>
          <div style="margin-top: 4px; font-size: 9.5px; color: #7DD3FC; font-weight: 600;">${tr('Click for museum dossier →', 'Klicken für Museums-Dossier →', 'Cliquer pour le dossier du musée →')}</div>
        </div>
      `;
      marker.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      marker.on('click', () => {
        onSelectNode({
          id: depot.name,
          label: depot.name,
          type: 'Institution',
          desc: depot.city,
          contested: depot.contested_count > 0,
          meta: depot
        });
      });

      marker.addTo(layersGroup);
    });

  }, [filteredData, selectedRouteId, onSelectNode, onSelectRoute, lang]);

  // 4. Render 243 Historical Colonial Expedition Events (Optional Layer)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const expGroup = expeditionsGroupRef.current;
    if (!map || !expGroup) return;

    expGroup.clearLayers();

    if (!showExpeditions) return;
    const tr = (en: string, de: string, fr: string) => (lang === 'de' ? de : lang === 'fr' ? fr : en);

    (geodata.expedition_events || []).forEach((ev: any) => {
      if (!ev.lat || !ev.lng) return;

      const marker = L.circleMarker([ev.lat, ev.lng], {
        radius: 4,
        fillColor: '#F59E0B',
        fillOpacity: 0.7,
        color: '#000000',
        weight: 1
      });

      const tooltipContent = `
        <div style="font-family: 'Inter', sans-serif; font-size: 11px; padding: 6px 9px; background: #141413; color: #F7F6F2; border: 1px solid #D97706; border-left: 3px solid #D97706; max-width: 280px;">
          <div style="font-weight: 700; color: #FDE68A;"><span style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;">#${ev.num}</span> ${ev.name}</div>
          <div style="font-size: 10px; color: #D6D3CB; margin-top: 2px;"><b>${tr('Period', 'Zeitraum', 'Période')}:</b> <span style="font-family:'IBM Plex Mono',ui-monospace,monospace;">${ev.zeitraum || '1884-1914'}</span></div>
          <div style="font-size: 10px; color: #D6D3CB;"><b>${tr('Locations', 'Orte', 'Lieux')}:</b> ${ev.orte || tr('Cameroon', 'Kamerun', 'Cameroun')}</div>
          <div style="font-size: 10px; color: #FCA5A5;"><b>${tr('Commander', 'Befehlshaber', 'Commandant')}:</b> ${ev.taeter || 'Schutztruppe'}</div>
          ${ev.zitat ? `<div style="font-size: 10px; color: #B5B3AC; font-style: italic; margin-top: 3px;">"${ev.zitat.slice(0, 120)}..."</div>` : ''}
          ${ev.link ? `<div style="font-size: 9.5px; color: #7DD3FC; margin-top: 3px;">${tr('BArch primary archive record available', 'BArch Primärbeleg vorhanden', "Source primaire d'archive BArch disponible")}</div>` : ''}
        </div>
      `;
      marker.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      marker.addTo(expGroup);
    });
  }, [showExpeditions, geodata, lang]);

  // Camera jump handlers
  const jumpToGlobal = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([28.0, 11.0], 3, { duration: 1.2 });
    }
  };

  const jumpToCameroon = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([5.8, 11.5], 7, { duration: 1.2 });
    }
  };

  const jumpToEurope = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([51.2, 10.5], 6, { duration: 1.2 });
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', backgroundColor: '#090A0F' }}>
      
      {/* Map Container */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />

      {/* Floating HUD Top Left: Camera Jumps & Layer Controls */}
      <div className="geo-hud-left">
        {/* Navigation buttons */}
        <div className="geo-hud-cam-bar">
          <button
            onClick={jumpToGlobal}
            style={{
              padding: '5px 10px',
              backgroundColor: '#F7F6F2',
              color: '#141413',
              border: '1px solid transparent',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {t('Global Vectors', 'Globale Vektoren', 'Vecteurs globaux')}
          </button>
          <button
            onClick={jumpToCameroon}
            style={{
              padding: '5px 10px',
              backgroundColor: '#991B1B',
              color: '#FFFFFF',
              border: '1px solid transparent',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {t('Focus: Cameroon', 'Fokus: Kamerun', 'Focus : Cameroun')}
          </button>
          <button
            onClick={jumpToEurope}
            style={{
              padding: '5px 10px',
              backgroundColor: 'transparent',
              color: '#F7F6F2',
              border: '1px solid rgba(255,255,255,0.28)',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {t('Focus: Europe', 'Fokus: Europa', 'Focus : Europe')}
          </button>
        </div>

        {/* 243 Expedition Sites Toggle */}
        <button
          onClick={() => setShowExpeditions(!showExpeditions)}
          style={{
            padding: '5px 10px',
            backgroundColor: showExpeditions ? '#D97706' : 'rgba(20, 20, 19, 0.90)',
            color: showExpeditions ? '#141413' : '#FBBF24',
            border: '1px solid rgba(251, 191, 36, 0.55)',
            fontSize: '10.5px',
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            alignSelf: 'flex-start',
            borderRadius: '2px'
          }}
        >
          {showExpeditions
            ? t('Hide 243 punitive expeditions (1884–1914)', '243 Strafexpeditionen ausblenden (1884–1914)', 'Masquer les 243 expéditions punitives (1884–1914)')
            : t('+ Show 243 punitive expeditions (1884–1914)', '+ 243 Strafexpeditionen einblenden (1884–1914)', '+ Afficher 243 expéditions punitives (1884–1914)')}
        </button>
      </div>

      {/* Floating HUD Top Right: Live Telemetry & Filter Info */}
      <div className="geo-hud-right">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.14)', paddingBottom: '5px', marginBottom: '7px', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#F7F6F2', fontSize: '11px' }}>
            {t('Geospatial Projection', 'Geodaten-Projektion', 'Projection géospatiale')}
          </span>
          <span className="mono" style={{ fontSize: '9.5px', color: loading ? '#FBBF24' : '#86EFAC', flexShrink: 0 }}>
            {loading ? t('Loading…', 'Lädt…', 'Chargement…') : t('Live', 'Aktiv', 'Actif')}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: '10.5px' }}>
          <div>
            <span style={{ color: '#A3A097' }}>{t('Origins:', 'Herkunft:', 'Origines :')}</span> <b className="mono">{filteredData.origins.length}</b>
          </div>
          <div>
            <span style={{ color: '#A3A097' }}>{t('Depots:', 'Depots:', 'Dépôts :')}</span> <b className="mono">{filteredData.depots.length}</b>
          </div>
          <div>
            <span style={{ color: '#A3A097' }}>{t('Routes:', 'Routen:', 'Routes :')}</span> <b className="mono">{filteredData.routes.length}</b>
          </div>
          <div>
            <span style={{ color: '#A3A097' }}>{t('Objects:', 'Objekte:', 'Objets :')}</span> <b className="mono" style={{ color: '#FCA5A5' }}>{filteredData.routes.reduce((acc: number, r: any) => acc + r.object_count, 0).toLocaleString()}</b>
          </div>
        </div>
        {activeMetricFilter && (
          <div style={{ marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '5px', fontSize: '10px', color: '#FBBF24' }}>
            {t('Filter:', 'Filter:', 'Filtre :')} {metricFilterLabel(activeMetricFilter, lang)}
          </div>
        )}
      </div>

      {/* Floating Bottom Legend */}
      <div className="geo-legend">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
          <span>{t('Cameroon (Origin)', 'Kamerun (Herkunft)', 'Cameroun (Origine)')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', backgroundColor: '#F7F6F2', border: '1px solid #141413', display: 'inline-block' }}></span>
          <span>{t('Depot (Europe)', 'Depot (Europa)', 'Dépôt (Europe)')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '14px', height: '2px', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
          <span>{t('Loot Vector', 'Raub-Vektor', 'Vecteur de pillage')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '14px', height: '2px', borderTop: '2px dashed #38BDF8', display: 'inline-block' }}></span>
          <span>{t('Suspicion', 'Verdacht', 'Soupçon')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#CA8A04', display: 'inline-block' }}></span>
          <span>{t('Dissonance', 'Dissonanz', 'Dissonance')}</span>
        </div>
        {showExpeditions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#F59E0B', display: 'inline-block' }}></span>
            <span>{t('Punitive Expedition (1884–1914)', 'Strafexpedition (1884–1914)', 'Expédition punitive (1884–1914)')}</span>
          </div>
        )}
      </div>

    </div>
  );
}
