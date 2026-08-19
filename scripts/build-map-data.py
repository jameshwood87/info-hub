import urllib.request, json, time, sys
UA="PropertyList-map/1.0 (+https://info.propertylist.es/map)"
MCP="https://mcp.propertylist.es/mcp"
def mcp(tool,args,tries=3):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":tool,"arguments":args}}).encode()
    for i in range(tries):
        try:
            raw=urllib.request.urlopen(urllib.request.Request(MCP,data=body,headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","User-Agent":UA,"MCP-Protocol-Version":"2025-06-18"}),timeout=60).read().decode()
            if "data:" in raw[:14]: raw="".join(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
            r=json.loads(raw).get("result",{})
            sc=r.get("structuredContent")
            if sc is not None: return sc
            return {"_text":" ".join(c.get("text","") for c in r.get("content",[]) if c.get("type")=="text")}
        except Exception as e:
            time.sleep(2*(i+1))
    return {}
MUNIS=["Marbella","Estepona","Benahavis","Mijas","Fuengirola","Benalmadena","Casares","Manilva"]
INE={"Marbella":"29069","Estepona":"29051","Benahavis":"29023","Mijas":"29070","Fuengirola":"29054","Benalmadena":"29025","Casares":"29041","Manilva":"29068"}
OPS=[("for-sale","sale"),("for-rent","rent"),("holiday-rentals","holiday")]
out={"generated":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"municipalities":{}}
for m in MUNIS:
    rec={"ine":INE[m],"ops":{}}
    for op,lab in OPS:
        s=mcp("area_market_summary",{"location":m,"search_type":op})
        if s.get("total_listings") is not None:
            rec["ops"][lab]={"n":s.get("total_listings"),"median":s.get("median_price"),"psm":s.get("median_price_per_sqm"),
                             "unit":s.get("price_unit"),"beds":s.get("by_bedroom_band")}
            if lab=="sale":
                o=s.get("oracle") or {}
                if o.get("verified"): rec["verified"]={"psm":o.get("verified_price_per_sqm"),"n":o.get("sample_size"),"period_end":o.get("period_end"),"url":o.get("attestation_url")}
        time.sleep(0.5)
    a=mcp("list_agencies",{"location":m,"limit":25})
    ags=a.get("agencies") or []
    rec["agencies"]={"count":len(ags),"top":[{"name":x.get("name"),"listings":x.get("listing_count")} for x in ags[:5]]}
    out["municipalities"][m]=rec
    print("%-12s sale=%-5s rent=%-4s hol=%-4s agencies=%-3s verified=%s"%(m,rec["ops"].get("sale",{}).get("n"),rec["ops"].get("rent",{}).get("n"),rec["ops"].get("holiday",{}).get("n"),rec["agencies"]["count"],(rec.get("verified") or {}).get("psm")),flush=True)
    time.sleep(0.5)
import os
for d in ["/opt/info-hub/public/map","/opt/info-hub/dist/client/map"]:
    if os.path.isdir(d): json.dump(out,open(d+"/map-data.json","w"),separators=(",",":"))
print("\nwrote map-data.json")
