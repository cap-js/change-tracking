/* eslint-disable no-undef */
import http from 'k6/http';
import { check, sleep } from 'k6';

const tags = { name: 'CT-PERF', query: 'Get changes' };

export const options = {
	stages: [
		{ duration: '10s', target: 50 },
		{ duration: '5m', target: 50 }
	]
};

export async function setup() {
	const passwordAuthResp = authenticateBTP();
	const res = http.post(
		`${__ENV.HOST}/odata/v4/admin/setupMockData`,
		{},
		{
			headers: {
				Authorization: `Bearer ${passwordAuthResp.access_token}`
			},
			tags: tags
		}
	);
	return { auth: passwordAuthResp, book_ID: res.json().bookID };
}

export default function (data) {
	const URL = `/odata/v4/admin/Books(${data.book_ID})/changes?$apply=orderby(createdAt%20desc)/com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/Books(${data.book_ID})/changes,HierarchyQualifier='ChangeHierarchy',NodeProperty='ID',Levels=1)&$select=DrillState,ID,attributeLabel,createdAt,createdBy,entityLabel,modificationLabel,objectID,valueChangedFromLabel,valueChangedToLabel&$count=true&$skip=0&$top=210`;
	const res = http.get(`${__ENV.HOST}${URL}`, {
		headers: {
			Authorization: `Bearer ${data.auth.access_token}`
		},
		tags: tags
	});

	check(res, { 'status is 200': (r) => r.status === 200 }, tags);

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
