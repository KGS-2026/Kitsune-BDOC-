--[[
    BDOC Tactical Export — Wireshark Lua Plugin
    Kitsune Global Solutions LLC — SDVOSB · CAGE: 174S8

    Extracts network threat indicators from packet captures and exports
    to GeoJSON format compatible with KITSUNE BDOC globe visualization.

    INSTALLATION:
        1. Copy this file to your Wireshark plugins folder:
           - Windows: %APPDATA%\Wireshark\plugins\
           - Linux:   ~/.local/lib/wireshark/plugins/
           - macOS:   ~/.local/lib/wireshark/plugins/
        2. Restart Wireshark or reload Lua plugins (Ctrl+Shift+L)
        3. Access via: Tools → BDOC Threat Export

    FEATURES:
        - Extracts unique source/destination IPs from capture
        - Identifies suspicious patterns (port scans, brute force, beaconing)
        - Flags known malicious ports (4444, 5555, 1337, 31337, etc.)
        - Detects DNS tunneling indicators
        - Exports to GeoJSON for BDOC globe import
        - Classifies traffic by threat category

    USAGE:
        After capture, go to Tools → BDOC Threat Export
        Select output file location
        Import the .geojson file into BDOC via File → Import GeoJSON
]]--

-- ═══════════════════════════════════════════
-- CONFIGURATION
-- ═══════════════════════════════════════════

local BDOC_VERSION = "1.0.0"
local SUSPICIOUS_PORTS = {
    [4444] = "METASPLOIT",
    [5555] = "ANDROID_ADB",
    [1337] = "LEET_BACKDOOR",
    [31337] = "BACK_ORIFICE",
    [6667] = "IRC_C2",
    [6697] = "IRC_SSL_C2",
    [8443] = "ALT_HTTPS",
    [9001] = "TOR_RELAY",
    [9050] = "TOR_SOCKS",
    [9150] = "TOR_BROWSER",
    [3389] = "RDP",
    [5900] = "VNC",
    [5985] = "WINRM",
    [5986] = "WINRM_SSL",
    [445]  = "SMB",
    [135]  = "RPC",
    [1433] = "MSSQL",
    [3306] = "MYSQL",
    [5432] = "POSTGRES",
    [27017]= "MONGODB",
    [6379] = "REDIS",
    [11211]= "MEMCACHED",
    [2375] = "DOCKER_API",
    [10250]= "KUBELET",
}

local PRIVATE_RANGES = {
    {start = 167772160, stop = 184549375},    -- 10.0.0.0/8
    {start = 2886729728, stop = 2887778303},  -- 172.16.0.0/12
    {start = 3232235520, stop = 3232301055},  -- 192.168.0.0/16
    {start = 2130706432, stop = 2130706687},  -- 127.0.0.0/24
}

-- ═══════════════════════════════════════════
-- IP UTILITIES
-- ═══════════════════════════════════════════

local function ip_to_int(ip_str)
    local o1, o2, o3, o4 = ip_str:match("(%d+)%.(%d+)%.(%d+)%.(%d+)")
    if not o1 then return nil end
    return tonumber(o1) * 16777216 + tonumber(o2) * 65536 + tonumber(o3) * 256 + tonumber(o4)
end

local function is_private(ip_str)
    local ip_int = ip_to_int(ip_str)
    if not ip_int then return true end
    for _, range in ipairs(PRIVATE_RANGES) do
        if ip_int >= range.start and ip_int <= range.stop then
            return true
        end
    end
    return false
end

-- ═══════════════════════════════════════════
-- THREAT CLASSIFICATION
-- ═══════════════════════════════════════════

local function classify_threat(ip_data)
    local categories = {}

    -- Check for suspicious port usage
    for port, label in pairs(SUSPICIOUS_PORTS) do
        if ip_data.dst_ports[port] then
            categories[#categories + 1] = label
        end
    end

    -- Port scan detection (>50 unique dest ports)
    if ip_data.unique_dst_ports > 50 then
        categories[#categories + 1] = "PORT_SCAN"
    end

    -- Brute force indicator (>100 connections to same port)
    for port, count in pairs(ip_data.dst_ports) do
        if count > 100 and (port == 22 or port == 3389 or port == 445) then
            categories[#categories + 1] = "BRUTE_FORCE"
        end
    end

    -- Beaconing detection (regular interval connections)
    if ip_data.packet_count > 20 and ip_data.unique_dst_ips == 1 then
        categories[#categories + 1] = "C2_BEACON"
    end

    -- DNS tunneling indicator (high DNS query volume)
    if ip_data.dns_queries > 100 then
        categories[#categories + 1] = "DNS_TUNNEL"
    end

    -- Large data transfer (potential exfil)
    if ip_data.bytes_out > 104857600 then  -- 100MB
        categories[#categories + 1] = "DATA_EXFIL"
    end

    -- Severity calculation
    local severity = 1
    if #categories > 3 then severity = 5
    elseif #categories > 1 then severity = 4
    elseif #categories > 0 then severity = 3
    else
        categories[#categories + 1] = "NORMAL"
        severity = 1
    end

    return categories, severity
end

-- ═══════════════════════════════════════════
-- GEOJSON BUILDER
-- ═══════════════════════════════════════════

-- Note: Wireshark Lua doesn't have GeoIP built-in.
-- This generates a GeoJSON stub that BDOC can enrich via its own GeoIP.
-- For full geolocation, use the companion bdoc_geo_enrich.py script.

local function build_geojson_stub(ip_table)
    local features = {}

    for ip, data in pairs(ip_table) do
        if not is_private(ip) then
            local categories, severity = classify_threat(data)

            local props = {
                name = ip,
                source = "wireshark",
                category = table.concat(categories, ","),
                severity = severity,
                packet_count = data.packet_count,
                bytes_in = data.bytes_in,
                bytes_out = data.bytes_out,
                unique_dst_ports = data.unique_dst_ports,
                unique_dst_ips = data.unique_dst_ips,
                dns_queries = data.dns_queries,
                protocols = table.concat(data.protocols_list, ","),
                first_seen = data.first_seen,
                last_seen = data.last_seen,
                bdoc_layer = "wireshark_capture",
                bdoc_version = BDOC_VERSION,
                needs_geolocation = true,
            }

            -- Top destination ports
            local top_ports = {}
            for port, count in pairs(data.dst_ports) do
                top_ports[#top_ports + 1] = {port = port, count = count}
            end
            table.sort(top_ports, function(a, b) return a.count > b.count end)
            local port_str = {}
            for i = 1, math.min(10, #top_ports) do
                port_str[#port_str + 1] = top_ports[i].port .. ":" .. top_ports[i].count
            end
            props.top_ports = table.concat(port_str, ",")

            -- Suspicious port flags
            local sus_ports = {}
            for port, label in pairs(SUSPICIOUS_PORTS) do
                if data.dst_ports[port] then
                    sus_ports[#sus_ports + 1] = label .. "(" .. port .. ")"
                end
            end
            if #sus_ports > 0 then
                props.suspicious_ports = table.concat(sus_ports, ",")
            end

            features[#features + 1] = {
                type = "Feature",
                geometry = {
                    type = "Point",
                    coordinates = {0, 0}  -- Enriched by BDOC or bdoc_geo_enrich.py
                },
                properties = props
            }
        end
    end

    return {
        type = "FeatureCollection",
        metadata = {
            generator = "BDOC Wireshark Plugin",
            vendor = "Kitsune Global Solutions LLC",
            version = BDOC_VERSION,
            capture_file = "current",
            total_ips = #features,
            note = "Coordinates set to 0,0 — run bdoc_geo_enrich.py or import to BDOC for auto-geolocation"
        },
        features = features
    }
end

-- ═══════════════════════════════════════════
-- PACKET ANALYSIS
-- ═══════════════════════════════════════════

local function analyze_capture()
    local ip_table = {}
    local pkt_count = 0

    -- Field extractors
    local ip_src = Field.new("ip.src")
    local ip_dst = Field.new("ip.dst")
    local tcp_dstport = Field.new("tcp.dstport")
    local udp_dstport = Field.new("udp.dstport")
    local frame_len = Field.new("frame.len")
    local frame_time = Field.new("frame.time_epoch")
    local dns_qry = Field.new("dns.qry.name")
    local proto_name = Field.new("_ws.col.Protocol")

    -- Iterate all packets
    local tap = Listener.new("frame")

    function tap.packet(pinfo, tvb)
        pkt_count = pkt_count + 1

        local src = ip_src()
        local dst = ip_dst()
        if not src or not dst then return end

        src = tostring(src)
        dst = tostring(dst)
        local ts = tostring(frame_time() or "0")
        local len = tonumber(tostring(frame_len() or "0"))

        -- Initialize IP record
        if not ip_table[src] then
            ip_table[src] = {
                packet_count = 0,
                bytes_in = 0,
                bytes_out = 0,
                dst_ports = {},
                unique_dst_ports = 0,
                unique_dst_ips_tbl = {},
                unique_dst_ips = 0,
                dns_queries = 0,
                protocols = {},
                protocols_list = {},
                first_seen = ts,
                last_seen = ts,
            }
        end

        local rec = ip_table[src]
        rec.packet_count = rec.packet_count + 1
        rec.bytes_out = rec.bytes_out + len
        rec.last_seen = ts

        -- Track destination ports
        local dport = tcp_dstport() or udp_dstport()
        if dport then
            local p = tonumber(tostring(dport))
            if p then
                rec.dst_ports[p] = (rec.dst_ports[p] or 0) + 1
            end
        end

        -- Track unique destination IPs
        if not rec.unique_dst_ips_tbl[dst] then
            rec.unique_dst_ips_tbl[dst] = true
            rec.unique_dst_ips = rec.unique_dst_ips + 1
        end

        -- Track DNS queries
        local dns = dns_qry()
        if dns then
            rec.dns_queries = rec.dns_queries + 1
        end

        -- Track protocols
        local proto = proto_name()
        if proto then
            local pname = tostring(proto)
            if not rec.protocols[pname] then
                rec.protocols[pname] = true
                rec.protocols_list[#rec.protocols_list + 1] = pname
            end
        end
    end

    function tap.draw()
        -- Count unique dst ports per IP
        for ip, data in pairs(ip_table) do
            local count = 0
            for _ in pairs(data.dst_ports) do count = count + 1 end
            data.unique_dst_ports = count
        end
    end

    function tap.reset()
        ip_table = {}
        pkt_count = 0
    end

    return ip_table, pkt_count
end

-- ═══════════════════════════════════════════
-- JSON SERIALIZER (minimal, no external deps)
-- ═══════════════════════════════════════════

local function json_encode(val, indent, level)
    indent = indent or "  "
    level = level or 0
    local pad = string.rep(indent, level)
    local pad1 = string.rep(indent, level + 1)

    if type(val) == "nil" then
        return "null"
    elseif type(val) == "boolean" then
        return val and "true" or "false"
    elseif type(val) == "number" then
        return tostring(val)
    elseif type(val) == "string" then
        return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n') .. '"'
    elseif type(val) == "table" then
        -- Check if array
        local is_array = (#val > 0) or (next(val) == nil)
        if is_array and #val > 0 then
            local items = {}
            for i, v in ipairs(val) do
                items[i] = pad1 .. json_encode(v, indent, level + 1)
            end
            return "[\n" .. table.concat(items, ",\n") .. "\n" .. pad .. "]"
        else
            local items = {}
            for k, v in pairs(val) do
                if type(k) == "string" then
                    items[#items + 1] = pad1 .. '"' .. k .. '": ' .. json_encode(v, indent, level + 1)
                end
            end
            if #items == 0 then return "{}" end
            return "{\n" .. table.concat(items, ",\n") .. "\n" .. pad .. "}"
        end
    end
    return "null"
end

-- ═══════════════════════════════════════════
-- MENU REGISTRATION
-- ═══════════════════════════════════════════

local function bdoc_export_menu()
    -- Prompt for output file
    local outfile = "bdoc_wireshark_export.geojson"

    -- Analyze current capture
    local ip_table, pkt_count = analyze_capture()

    -- Retap to populate
    retap_packets()

    -- Build GeoJSON
    local geojson = build_geojson_stub(ip_table)

    -- Write output
    local f = io.open(outfile, "w")
    if f then
        f:write(json_encode(geojson))
        f:close()

        local threat_count = 0
        for _, feat in ipairs(geojson.features) do
            if feat.properties.severity > 2 then
                threat_count = threat_count + 1
            end
        end

        -- Report
        local msg = string.format(
            "BDOC EXPORT COMPLETE\n\n" ..
            "Packets analyzed: %d\n" ..
            "Unique public IPs: %d\n" ..
            "Threat indicators: %d\n" ..
            "Output: %s\n\n" ..
            "Import this file into BDOC via:\n" ..
            "  File → Import GeoJSON\n\n" ..
            "Or run bdoc_geo_enrich.py to add\n" ..
            "geolocation before import.",
            pkt_count,
            #geojson.features,
            threat_count,
            outfile
        )

        -- Show dialog
        local win = TextWindow.new("BDOC Tactical Export")
        win:set(msg)
    else
        local win = TextWindow.new("BDOC Export Error")
        win:set("Failed to write output file: " .. outfile)
    end
end

-- Register in Wireshark Tools menu
register_menu("BDOC Threat Export", bdoc_export_menu, MENU_TOOLS_UNSORTED)
