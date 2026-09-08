import { create, toBinary, fromBinary, toJson, fromJson } from "@bufbuild/protobuf";
import { MultipleLocationMessageSchema } from "./gen/wahoindex/wahoindex_pb";

const APP_KEY = "67D5833A-80B5-4F9E-9C2B-9E7BAA634C27";
const DEBUG = false;
const PER_FETCH_COUNT = DEBUG ? 10 : 100;

const DEFAULT_RESPONSE = `
Hello! Theres a few "endpoints" here:
/locations.json - waffle house locations, their schedules, and status
/locations.pbf - the same as above, but as a protobuf
/locations.pbf.json - the same as above, but converted back to json for debug purposes

Data is cached on the CDN to live for 10 minutes, so fetching more frequently than that won't do you much. 

Possible openingStatus values (i've seen at least):
- 'open' - yay!!!
- 'temporarily_closed' - fuck...
- 'permanently_closed' - bruh
`.trim();

// https://microlink.io/user-agents
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
];

const fetchData = async (offset, limit) => {
  const USER_AGENT = Math.floor(Math.random() * USER_AGENTS.length);
  const STANDARD_HEADERS = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Pragma: "no-cache",
    "Cache-Control": "no-cache"
  };
  const STANDARD_CONFIG = {
    credentials: "omit",
    headers: STANDARD_HEADERS,
    body: JSON.stringify({
      request: {
        appkey: APP_KEY,
        formdata: {
          geoip: false,
          dataview: "store_default",
          limit: limit,
          stateonly: 1,
          searchradius: "5000",
          geolocs: { geoloc: [{ latitude: "39.8283", longitude: "-98.5795", country: "US" }] },
          offset: offset
        }
      }
    }),
    referrer: "https://locations.wafflehouse.com/",
    method: "POST",
    mode: "cors"
  };

  const wahoData = await fetch(
    "https://locations.wafflehouse.com/rest/locatorsearch?isSOCiLocator=true",
    STANDARD_CONFIG
  ).then(async (res) => {
    if (!res.ok) {
      const resText = await res.text();
      throw new Error(`Error fetching | offset ${offset} | limit ${limit} | ${resText}`);
    }

    return res.json();
  });

  return wahoData;
};

const processHours = (rawHoursObj) => {
  let some24Hours = false;

  const processDay = (day_open, day_close) => {
    if (!day_open || !day_close) return { open: day_open, close: day_close, is24Hours: false, isOpen: false };

    let thisIs24Hours = day_open == "00:00" && day_close == "00:00";

    if (thisIs24Hours) some24Hours = true;

    return { open: day_open, close: day_close, is24Hours: thisIs24Hours, isOpen: true };
  };

  if (!rawHoursObj || Object.keys(rawHoursObj).length == 0) {
    return { is24Hours: false, some24Hours: false, hasNoHours: true, days: null };
  }

  let finalDays = {};

  const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  // filling in data
  dayKeys.forEach((dayKey) => {
    finalDays[dayKey] = processDay(rawHoursObj[`${dayKey}_open`], rawHoursObj[`${dayKey}_close`]);
  });

  const allDaysAre24Hours = dayKeys.every((dayKey) => finalDays[dayKey]?.is24Hours);

  return { is24Hours: allDaysAre24Hours, some24Hours: some24Hours, hasNoHours: false, days: finalDays };
};

export default {
  async fetch(request, env, ctx) {
    try {
      let returnJSON = false;
      let returnPBF = false;
      let returnPBFJSON = false;

      if (request.url.endsWith("locations.json")) returnJSON = true;
      else if (request.url.endsWith("locations.pbf")) returnPBF = true;
      else if (request.url.endsWith("locations.pbf.json")) returnPBFJSON = true;
      else if (request.url.endsWith("wahoindex.proto")) {
        return new Response(protofile);
      } else return new Response(DEFAULT_RESPONSE);

      const timeGenerated = new Date().toISOString();
      let finalLocations = [];
      let rawLocations = [];
      let currentOffset = 0;
      let finalized = false;

      //protbuf
      let message = null;
      let encoded = null;

      while (!finalized) {
        const thisData = await fetchData(currentOffset, PER_FETCH_COUNT);

        if (!thisData?.response?.collection) {
          finalized = true;
          break;
        } else {
          currentOffset += PER_FETCH_COUNT;
        }

        if (DEBUG) finalized = true;

        thisData?.response?.collection?.forEach((item) => {
          const store_code = item.name.split("#")[1];

          if (DEBUG) rawLocations.push(item);

          const standardHours = processHours(item.location?.hours);

          finalLocations.push({
            uid: item.uid,
            name: item.name,
            storeNumber: store_code,
            address: {
              streetLine1: item.location?.address?.address_line_1,
              streetLine2: item.location?.address?.address_line_2,
              city: item.location?.address?.city,
              state: item.location?.address?.state_province,
              zip: item.location?.address?.postal_code,
              country: item.location?.address?.country
            },
            coords: { lon: parseFloat(item.longitude), lat: parseFloat(item.latitude) },
            hours: {
              standard: standardHours,
              dineIn: processHours(item.location?.more_hours?.access),
              delivery: processHours(item.location?.more_hours?.delivery),
              takeout: processHours(item.location?.more_hours?.takeout),
              special: processHours(item.location?.special_hours)
            },
            openingStatus: item.location?.opening_status,
            openingStatusDetailed: {
              isOpen: item.location?.opening_status == "open",
              isTempClosed: item.location?.opening_status == "temporarily_closed",
              isPermClosed: item.location?.opening_status == "permanently_closed",
              isDeliveryOnly: item?.["Delivery Only"] == "yes",
              isComingSoon: item?.["Coming Soon"] == "yes",
              hasSpecialHours: Object.keys(item.location?.special_hours).length > 0,
            }
          });
        });
      }

      if (returnPBF || returnPBFJSON) {
        message = create(MultipleLocationMessageSchema, {
          timeGenerated,
          locations: finalLocations,
          error: null,
          errorStack: null
        });
        encoded = toBinary(MultipleLocationMessageSchema, message);
      }

      if (returnJSON) {
        let finalResponseObj = {
          timeGenerated,
          locations: finalLocations,
          error: null,
          errorStack: null
        };

        if (DEBUG) {
          finalResponseObj["rawLocations"] = rawLocations;
        }

        return Response.json(finalResponseObj, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "cloudflare-cdn-cache-control": "public, max-age=600",
            "cdn-cache-control": "public, max-age=600"
          }
        });
      } else if (returnPBF) {
        return new Response(encoded, {
          headers: {
            "Content-Type": "application/x-protobuf",
            "Cache-Control": "public, max-age=60",
            "cloudflare-cdn-cache-control": "public, max-age=600",
            "cdn-cache-control": "public, max-age=600"
          }
        });
      } else if (returnPBFJSON) {
        return Response.json(fromBinary(MultipleLocationMessageSchema, encoded), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "cloudflare-cdn-cache-control": "public, max-age=600",
            "cdn-cache-control": "public, max-age=600"
          }
        });
      } else {
        // we shouldnt be here
        return new Response(DEFAULT_RESPONSE);
      }
    } catch (e) {
      console.log(e);
      return Response.json(
        { locations: [], specialHoursLocations: [], notOpenLocations: [], error: e.toString(), errorStack: e.stack },
        { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }
      );
    }
  }
};
