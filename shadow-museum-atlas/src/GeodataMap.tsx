// @ts-nocheck
import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import fallbackGeodata from './geodata.json';

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
      attributionControl: false
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
        <div style="font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 6px; background: #000; color: #fff; border: 2px solid ${strokeColor};">
          <div style="font-weight: 900; color: ${strokeColor};">[RAUB-VEKTOR: ${route.origin_name.toUpperCase()} &rarr; ${route.depot_city.toUpperCase()}]</div>
          <div style="margin-top: 3px; font-size: 9px;"><b>Kulturgüter:</b> ${route.object_count} Objekte</div>
          <div style="font-size: 8px; color: #94A3B8;"><b>Depot:</b> ${route.depot_name}</div>
          <div style="font-size: 8px; color: #F59E0B;"><b>Expedition:</b> ${route.expeditions.join(', ')}</div>
          <div style="font-size: 8px; color: #CBD5E1;"><b>Akteure:</b> ${route.actors.join(', ') || 'Unbekannt'}</div>
          <div style="margin-top: 4px; font-size: 8px; color: #38BDF8; font-weight: bold;">[KLICKEN FÜR FORENSISCHE FALLAKTE]</div>
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
        <div style="font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 6px; background: #000; color: #fff; border: 2px solid ${fillColor};">
          <div style="font-weight: 900; color: ${fillColor};">[ORIGIN: ${orig.name.toUpperCase()}]</div>
          <div style="font-size: 9px; margin-top: 2px;"><b>Region:</b> ${orig.region}</div>
          <div style="font-size: 9px; color: #F87171;"><b>Raubkunst:</b> ${orig.object_count} Objekte</div>
          <div style="font-size: 8px; color: #94A3B8;"><b>Ziel-Depots:</b> ${orig.depot_ids.length} Museen in Europa</div>
          <div style="font-size: 8px; color: #F59E0B;"><b>Expeditionen:</b> ${orig.expeditions.slice(0, 3).join(', ')}</div>
          <div style="margin-top: 4px; font-size: 8px; color: #38BDF8; font-weight: bold;">[KLICKEN ZUM ISOLIEREN]</div>
        </div>
      `;
      marker.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      marker.on('click', () => {
        onSelectNode({
          id: orig.id,
          label: orig.name,
          type: 'Polity',
          desc: `${orig.region} | ${orig.object_count} geraubte Kulturgüter`,
          contested: orig.contested_count > 0,
          meta: orig
        });
      });

      marker.addTo(layersGroup);
    });

    // 3.3 Render European Museum Depots
    filteredData.depots.forEach((depot: any) => {
      // Create brutalist HTML badge for museum hubs
      const depotIcon = L.divIcon({
        className: 'custom-depot-pin',
        html: `
          <div style="
            background-color: #000000;
            color: #FFFFFF;
            border: 2px solid #FFFFFF;
            box-shadow: 3px 3px 0px #DC2626;
            padding: 3px 6px;
            font-family: 'Space Mono', monospace;
            font-size: 9px;
            font-weight: 900;
            white-space: nowrap;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transform: translate(-50%, -50%);
          ">
            <span style="display:inline-block; width:6px; height:6px; background-color:#DC2626; border-radius:50%;"></span>
            <span>${depot.city.toUpperCase()}: ${depot.object_count.toLocaleString()}</span>
          </div>
        `,
        iconSize: [80, 24],
        iconAnchor: [40, 12]
      });

      const marker = L.marker([depot.lat, depot.lng], { icon: depotIcon });

      const tooltipContent = `
        <div style="font-family: 'Space Mono', monospace; font-size: 10px; padding: 6px 8px; background: #000; color: #fff; border: 2px solid #FFF;">
          <div style="font-weight: 900; color: #38BDF8;">[DEPOT: ${depot.name.toUpperCase()}]</div>
          <div style="font-size: 9px; margin-top: 2px;"><b>Standort:</b> ${depot.address}</div>
          <div style="font-size: 9px; color: #DC2626; font-weight: bold;"><b>Geraubte Kulturgüter:</b> ${depot.object_count.toLocaleString()}</div>
          <div style="font-size: 8px; color: #94A3B8;"><b>Kamerun-Herkunftsorte:</b> ${depot.origin_ids.length} Distrikte</div>
          <div style="margin-top: 4px; font-size: 8px; color: #38BDF8; font-weight: bold;">[KLICKEN FÜR MUSEUMS-DOSSIER]</div>
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

  }, [filteredData, selectedRouteId, onSelectNode, onSelectRoute]);

  // 4. Render 243 Historical Colonial Expedition Events (Optional Layer)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const expGroup = expeditionsGroupRef.current;
    if (!map || !expGroup) return;

    expGroup.clearLayers();

    if (!showExpeditions) return;

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
        <div style="font-family: 'Space Mono', monospace; font-size: 9px; padding: 4px 6px; background: #000; color: #F59E0B; border: 1px solid #F59E0B; max-width: 280px;">
          <div style="font-weight: 900;">[EXPEDITION #${ev.num}: ${ev.name}]</div>
          <div style="font-size: 8px; color: #CBD5E1; margin-top: 2px;"><b>Zeitraum:</b> ${ev.zeitraum || '1884-1914'}</div>
          <div style="font-size: 8px; color: #CBD5E1;"><b>Orte:</b> ${ev.orte || 'Kamerun'}</div>
          <div style="font-size: 8px; color: #F87171;"><b>Befehlshaber:</b> ${ev.taeter || 'Schutztruppe'}</div>
          ${ev.zitat ? `<div style="font-size: 8px; color: #94A3B8; font-style: italic; margin-top: 3px;">"${ev.zitat.slice(0, 120)}..."</div>` : ''}
          ${ev.link ? `<div style="font-size: 7px; color: #38BDF8; margin-top: 3px;">[BArch Primärbeleg vorhanden]</div>` : ''}
        </div>
      `;
      marker.bindTooltip(tooltipContent, { sticky: true, opacity: 0.95 });

      marker.addTo(expGroup);
    });
  }, [showExpeditions, geodata]);

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
      <div style={{
        position: 'absolute',
        top: 14,
        left: 14,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        {/* Navigation buttons */}
        <div style={{
          display: 'flex',
          gap: '4px',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          padding: '4px',
          border: '2px solid #000000',
          boxShadow: '3px 3px 0px #000000'
        }}>
          <button
            onClick={jumpToGlobal}
            style={{
              padding: '4px 8px',
              backgroundColor: '#FFFFFF',
              color: '#000000',
              border: '1px solid #000000',
              fontSize: '9px',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            [GLOBALE VEKTOREN]
          </button>
          <button
            onClick={jumpToCameroon}
            style={{
              padding: '4px 8px',
              backgroundColor: '#DC2626',
              color: '#FFFFFF',
              border: '1px solid #000000',
              fontSize: '9px',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            [FOKUS: KAMERUN]
          </button>
          <button
            onClick={jumpToEurope}
            style={{
              padding: '4px 8px',
              backgroundColor: '#000000',
              color: '#FFFFFF',
              border: '1px solid #FFFFFF',
              fontSize: '9px',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            [FOKUS: EUROPA]
          </button>
        </div>

        {/* 243 Expedition Sites Toggle */}
        <button
          onClick={() => setShowExpeditions(!showExpeditions)}
          style={{
            padding: '5px 10px',
            backgroundColor: showExpeditions ? '#F59E0B' : 'rgba(0, 0, 0, 0.85)',
            color: showExpeditions ? '#000000' : '#F59E0B',
            border: '2px solid #F59E0B',
            boxShadow: '3px 3px 0px #000000',
            fontSize: '9px',
            fontWeight: 900,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          {showExpeditions
            ? '[EXPEDITIONEN AKTIV (243 RAIDS AUSBLENDEN)]'
            : '[+ 243 STRAFEXPEDITIONEN EINBLENDEN (1884-1914)]'}
        </button>
      </div>

      {/* Floating HUD Top Right: Live Telemetry & Filter Info */}
      <div style={{
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.90)',
        border: '2px solid #FFFFFF',
        boxShadow: '4px 4px 0px #DC2626',
        padding: '8px 12px',
        color: '#FFFFFF',
        fontFamily: "'Space Mono', monospace",
        fontSize: '9px',
        maxWidth: '340px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '4px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 900, color: '#DC2626', letterSpacing: '0.5px' }}>
            [GEODATEN-PROJEKTION AKTIV]
          </span>
          <span style={{ fontSize: '8px', color: '#94A3B8' }}>
            {loading ? 'LÄDT...' : 'ONLINE'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '9px' }}>
          <div>
            <span style={{ color: '#94A3B8' }}>Herkunftsorte:</span> <b>{filteredData.origins.length}</b>
          </div>
          <div>
            <span style={{ color: '#94A3B8' }}>Ziel-Depots:</span> <b>{filteredData.depots.length}</b>
          </div>
          <div>
            <span style={{ color: '#94A3B8' }}>Raub-Routen:</span> <b>{filteredData.routes.length}</b>
          </div>
          <div>
            <span style={{ color: '#94A3B8' }}>Objekte:</span> <b style={{ color: '#DC2626' }}>{filteredData.routes.reduce((acc: number, r: any) => acc + r.object_count, 0).toLocaleString()}</b>
          </div>
        </div>
        {activeMetricFilter && (
          <div style={{ marginTop: '6px', borderTop: '1px solid #334155', paddingTop: '4px', fontSize: '8px', color: '#F59E0B' }}>
            FILTER: [{activeMetricFilter.toUpperCase()}]
          </div>
        )}
      </div>

      {/* Floating Bottom Legend */}
      <div style={{
        position: 'absolute',
        bottom: 14,
        left: 14,
        zIndex: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.90)',
        border: '2px solid #000000',
        boxShadow: '3px 3px 0px #000000',
        padding: '6px 12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontFamily: "'Space Mono', monospace",
        fontSize: '9px',
        color: '#FFFFFF'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
          <span>KAMERUN (HERKUNFT)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', backgroundColor: '#FFFFFF', border: '1px solid #000', display: 'inline-block' }}></span>
          <span>DEPOT (EUROPA)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '16px', height: '3px', backgroundColor: '#DC2626', display: 'inline-block' }}></span>
          <span>RAUB-VEKTOR</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '16px', height: '3px', borderTop: '2px dashed #0891B2', display: 'inline-block' }}></span>
          <span>VERDACHT (PROBABILISTISCH)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#CA8A04', display: 'inline-block' }}></span>
          <span>DISSONANZ (DISPUTIERT)</span>
        </div>
        {showExpeditions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B', display: 'inline-block' }}></span>
            <span>STRAFEXPEDITION (1884-1914)</span>
          </div>
        )}
      </div>

    </div>
  );
}
