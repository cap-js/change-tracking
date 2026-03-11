/* eslint-disable no-undef */
import http from 'k6/http';
import { check, sleep } from 'k6';

const tags = { name: 'CT-PERF', query: 'New entity' };

export const options = {
	stages: [
		{ duration: '10s', target: 50 },
		{ duration: '5m', target: 50 }
	]
};

export async function setup() {
	const passwordAuthResp = authenticateBTP();
	return { auth: passwordAuthResp };
}

export default function (data) {
	const URL = `/odata/v4/admin/Books`;
	const payload = JSON.stringify({
		name: `Book ${Math.round(Math.random() * 100000)}`
	});
	const res = http.post(`${__ENV.HOST}${URL}`, payload, {
		headers: {
			Authorization: `Bearer ${data.auth.access_token}`,
			'Content-Type': 'application/json'
		},
		tags: tags
	});
	check(res, { 'status is 201': (r) => r.status === 201 }, tags);

	sleep(1);
}

export function authenticateBTP() {
	let formData = {
		client_id: __ENV.CLIENT_ID,
		client_secret: __ENV.CLIENT_SECRET,
		grant_type: 'client_credentials'
	};
	let headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
	const response = http.post(__ENV.TOKEN_URL, formData, { headers, tags: tags });

	return response.json();
}
