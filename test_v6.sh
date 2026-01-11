#!/bin/bash

BASE_URL="https://webzyl-worker.rinil-kuriakose093.workers.dev/api/booking"

echo "=== Test 1: Basic Booking ==="
curl -X POST $BASE_URL -H "Content-Type: application/json" -d '{"slug":"mountview","name":"Test 1","email":"test1@example.com","phone":"+911111111111","checkIn":"2026-05-15","guests":"2"}'
echo -e "\n"

echo "=== Test 2: Duplicate (should fail) ==="
curl -X POST $BASE_URL -H "Content-Type: application/json" -d '{"slug":"mountview","name":"Test 1","email":"test1@example.com","phone":"+911111111111","checkIn":"2026-05-15","guests":"2"}'
echo -e "\n"

echo "=== Test 3: Invalid Property (should fail) ==="
curl -X POST $BASE_URL -H "Content-Type: application/json" -d '{"slug":"invalid","name":"Test 3","email":"test3@example.com","phone":"+913333333333","checkIn":"2026-05-20","guests":"2"}'
echo -e "\n"

echo "=== Test 4: Missing Fields (should fail) ==="
curl -X POST $BASE_URL -H "Content-Type: application/json" -d '{"slug":"mountview","email":"test4@example.com"}'
echo -e "\n"

echo "=== All tests complete! ==="