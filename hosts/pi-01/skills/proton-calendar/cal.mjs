#!/usr/bin/env node
// Proton Calendar from the shell. Config: ~/.pi/agent/calendar.json. Sent invites: ~/.pi/agent/calendar-sent.jsonl.
//   cal.mjs events <from> <to> [query]
//   cal.mjs invite --title T --start S [--end E] [--location L] [--description D] [--with name|email]...
//   cal.mjs update <uid> [same flags as invite; omitted ones keep their sent value]
//   cal.mjs sent [query]
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import ICAL from 'ical.js';
import nodemailer from 'nodemailer';

const AGENT = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const CONFIG = join(AGENT, 'calendar.json');
const SENT = join(AGENT, 'calendar-sent.jsonl');
const c = JSON.parse(readFileSync(CONFIG, 'utf8'));
const zone = c.timeZone ?? 'America/Los_Angeles';

function offset(ms) {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
			.formatToParts(ms)
			.map((x) => [x.type, Number(x.value)])
	);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** Wall time in the configured zone ("2026-10-29T14:00" or "2026-10-29") to a Date. */
function local(text) {
	if (/[zZ]|[+-]\d\d:?\d\d$/.test(text)) return new Date(text);
	const m = text.match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?$/);
	if (!m) throw new Error(`Bad date/time: ${text} (use YYYY-MM-DD or YYYY-MM-DDTHH:MM)`);
	const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
	return new Date(wall - offset(wall - offset(wall)));
}
const fmt = (d, allDay) =>
	new Intl.DateTimeFormat('en-GB', { timeZone: allDay ? 'UTC' : zone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }) }).format(d);
const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(d);

async function events(fromText, toText, query) {
	const from = local(fromText);
	const to = local(toText);
	const res = await fetch(c.icsUrl.replace(/^webcal:/, 'https:'));
	if (!res.ok) throw new Error(`Fetching the calendar failed: HTTP ${res.status}`);
	const root = new ICAL.Component(ICAL.parse(await res.text()));
	for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
	const series = new Map();
	const exceptions = [];
	for (const v of root.getAllSubcomponents('vevent')) {
		const e = new ICAL.Event(v);
		if (e.isRecurrenceException()) exceptions.push(e);
		else series.set(e.uid, e);
	}
	for (const e of exceptions) series.get(e.uid)?.relateException(e);
	const out = [];
	const add = (start, end, ev) => {
		const s = start.toJSDate();
		const e = end.toJSDate();
		if (e > from && s < to && ev.component.getFirstPropertyValue('status') !== 'CANCELLED') out.push({ s, e, allDay: start.isDate, ev });
	};
	for (const e of series.values()) {
		if (!e.isRecurring()) {
			add(e.startDate, e.endDate ?? e.startDate, e);
			continue;
		}
		const it = e.iterator();
		for (let next = it.next(), n = 0; next && n < 5000; next = it.next(), n++) {
			if (next.toJSDate() >= to) break;
			const d = e.getOccurrenceDetails(next);
			add(d.startDate, d.endDate, d.item);
		}
	}
	const q = query?.toLowerCase();
	const list = out
		.filter(({ ev }) => !q || [ev.summary, ev.location, ev.description].some((x) => x?.toLowerCase().includes(q)))
		.sort((a, b) => a.s - b.s);
	console.log(`Time zone: ${zone}. ${list.length} event(s).`);
	for (const { s, e, allDay, ev } of list) {
		const when = allDay
			? `${fmt(s, true)} (all day${e - s > 86_400_000 ? ` until ${fmt(new Date(+e - 1), true)}` : ''})`
			: `${fmt(s, false)} – ${hm(e)}`;
		const extra = [ev.location && `@ ${ev.location}`, ev.description?.replace(/\s+/g, ' ').slice(0, 200)].filter(Boolean).join(' — ');
		console.log(`- ${when}: ${ev.summary ?? '(no title)'}${extra ? ` — ${extra}` : ''}`);
	}
}

const sentLog = () =>
	existsSync(SENT) ? readFileSync(SENT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

/** "cat" → the address in config.people; anything with @ is taken as is. */
function resolve(who) {
	if (who.includes('@')) return who;
	const hit = Object.entries(c.people ?? {}).find(([k]) => k.toLowerCase() === who.toLowerCase());
	if (!hit) throw new Error(`Unknown person "${who}"; add them to "people" in ${CONFIG} or pass an email`);
	return hit[1];
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function send(ev) {
	const allDay = /^\d{4}-\d\d-\d\d$/.test(ev.start);
	let dates, when;
	if (allDay) {
		const last = ev.end ?? ev.start;
		const endExcl = new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10) + 1));
		dates = [`DTSTART;VALUE=DATE:${ev.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${endExcl.toISOString().slice(0, 10).replace(/-/g, '')}`];
		when = `${ev.start}${last !== ev.start ? ` to ${last}` : ''} (all day)`;
	} else {
		const s = local(ev.start);
		const e = ev.end ? local(ev.end) : new Date(+s + 3_600_000);
		if (e <= s) throw new Error('end must be after start');
		dates = [`DTSTART:${utc(s)}`, `DTEND:${utc(e)}`];
		when = `${fmt(s, false)} – ${hm(e)} (${zone})`;
	}
	const attendees = [...new Set([c.to, ...ev.with])];
	const ics = [
		'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//pi//proton-calendar//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
		`UID:${ev.uid}`, `DTSTAMP:${utc(new Date())}`, ...dates, `SUMMARY:${esc(ev.title)}`,
		...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
		...(ev.description ? [`DESCRIPTION:${esc(ev.description)}`] : []),
		`ORGANIZER:mailto:${c.from}`,
		...attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`),
		`SEQUENCE:${ev.sequence}`, 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR', ''
	].join('\r\n');
	const { insecureTls, ...smtp } = c.smtp;
	const transport = nodemailer.createTransport({
		host: smtp.host, port: smtp.port, secure: smtp.secure ?? smtp.port === 465,
		auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 20_000,
		...(insecureTls ? { tls: { rejectUnauthorized: false } } : {})
	});
	const mail = {
		from: c.from, to: attendees.join(', '),
		subject: `${ev.sequence ? 'Updated invitation' : 'Invitation'}: ${ev.title}`,
		text: `${ev.title}\n${when}${ev.location ? `\n${ev.location}` : ''}${ev.description ? `\n\n${ev.description}` : ''}`,
		icalEvent: { method: 'REQUEST', content: ics }
	};
	for (let attempt = 1; ; attempt++) {
		try {
			await transport.sendMail(mail);
			break;
		} catch (error) {
			if (attempt === 3 || !/timeout|ECONN|ETIMEDOUT/i.test(String(error?.code ?? error))) throw error;
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	appendFileSync(SENT, JSON.stringify({ ...ev, sentAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
	console.log(`Sent to ${attendees.join(', ')}: ${ev.title}, ${when}. UID ${ev.uid} (sequence ${ev.sequence}).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = {
	title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
	location: { type: 'string' }, description: { type: 'string' }, with: { type: 'string', multiple: true }
};
try {
	if (cmd === 'events') await events(rest[0], rest[1], rest[2]);
	else if (cmd === 'sent') {
		const q = rest[0]?.toLowerCase();
		const latest = new Map(sentLog().map((e) => [e.uid, e]));
		for (const e of latest.values())
			if (!q || JSON.stringify(e).toLowerCase().includes(q)) console.log(JSON.stringify(e));
	} else if (cmd === 'invite') {
		const { values: v } = parseArgs({ args: rest, options: flags });
		if (!v.title || !v.start) throw new Error('--title and --start are required');
		await send({ uid: `${randomUUID()}@pi`, sequence: 0, title: v.title, start: v.start, end: v.end, location: v.location, description: v.description, with: (v.with ?? []).map(resolve) });
	} else if (cmd === 'update') {
		const { values: v, positionals } = parseArgs({ args: rest, options: flags, allowPositionals: true });
		const uid = positionals[0];
		const prev = sentLog().filter((e) => e.uid === uid).at(-1);
		if (!prev) throw new Error(`No sent invite with UID ${uid}; see \`cal.mjs sent\``);
		const ev = { ...prev, sentAt: undefined, sequence: prev.sequence + 1 };
		for (const k of ['title', 'start', 'end', 'location', 'description']) if (v[k] !== undefined) ev[k] = v[k];
		if (v.with) ev.with = [...new Set([...prev.with, ...v.with.map(resolve)])];
		await send(ev);
	} else {
		console.log('Usage: cal.mjs events <from> <to> [query] | invite --title T --start S [...] [--with cat] | update <uid> [--with x] | sent [query]');
		process.exit(cmd ? 1 : 0);
	}
} catch (error) {
	console.error(String(error?.message ?? error));
	process.exit(1);
}
