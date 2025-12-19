curl -s "$BASE/api/v3/process" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleGkiOjYwMCwiZXhwIjoxNzY2MTg2ODYwLCJpYXQiOjE3NjYxODYyNjAsImlzcyI6ImRhdGFyaGVpLWNvcmUiLCJqdGkiOiJkNGViMTRkYi0yMGQ5LTQyNmMtOTZhZi0xYzcwZjUyMjUzYmUiLCJzdWIiOiJhZG1pbiIsInVzZWZvciI6ImFjY2VzcyJ9.3Q2fkti6sMU9u4Pw5suwf9oFJKO0PNf5-BcYw23wkDs","refresh_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleGkiOjg2NDAwLCJleHAiOjE3NjYyNzI2NjAsImlhdCI6MTc2NjE4NjI2MCwiaXNzIjoiZGF0YXJoZWktY29yZSIsImp0aSI6IjA4ZDlkYjE2LWE4ODMtNDEyNi1hNWJlLTk1NWEzNDRkYTk5OCIsInN1YiI6ImFkbWluIiwidXNlZm9yIjoicmVmcmVzaCJ9.3lk2OASxYdx0fIoHHympHIGmNazYnF22BzVjNCs4Xwk" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test",
    "autostart": false,
    "options": ["-loglevel","error"],
    "input": [
      {"id":"v","address":"testsrc=size=1280x720:rate=30","options":["-f","lavfi"]},
      {"id":"a","address":"sine=frequency=1000","options":["-f","lavfi"]}
    ],
    "output": [
      {"id":"twitch","address":"rtmp://live.twitch.tv/app/live_178021649_Na2M47H4xJdmt3rS5iC9dXjtDb5I07",
       "options":["-c:v","libx264","-preset","veryfast","-tune","zerolatency","-pix_fmt","yuv420p",
                  "-c:a","aac","-ar","44100","-b:a","128k","-f","flv"]}
    ]
  }'
