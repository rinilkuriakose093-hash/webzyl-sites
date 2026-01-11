# API Test Cases

This directory contains test cases for all API endpoints in the webzyl-worker system.

## Purpose

As we add new features to the system, we need to ensure that existing functionality continues to work correctly. This test case tracking system helps us:

1. Document all API endpoints and their expected behavior
2. Track test results after each major feature addition
3. Prevent regressions by maintaining a comprehensive test suite
4. Provide clear examples of how each API should be used

## File Structure

- `API_Test_Cases.csv` - Main test case tracking spreadsheet (can be opened in Excel)

## Test Case Format

Each test case in the CSV includes:

- **Test ID** - Unique identifier (TC001, TC002, etc.)
- **Feature** - The feature category (Config Management, Room Management, etc.)
- **API Endpoint** - The full endpoint path
- **Method** - HTTP method (GET, POST, PUT, DELETE)
- **Description** - What the API does
- **Request Body/Params** - Sample request data
- **Expected Status** - HTTP status code (200, 400, 404, etc.)
- **Expected Response** - Sample response or description
- **Actual Status** - Actual status from test run
- **Actual Response** - Actual response from test run
- **Pass/Fail** - Test result
- **Notes** - Any additional observations
- **Date Tested** - When the test was last run
- **Tested By** - Who ran the test

## Workflow

### When Adding New Features

1. **Add Test Cases** - Add new rows to `API_Test_Cases.csv` for any new API endpoints
2. **Document Behavior** - Include example requests and expected responses
3. **Run Initial Tests** - Test the new endpoints and document results

### After Major Features

1. **Run Regression Tests** - Test ALL endpoints in the CSV, not just new ones
2. **Update Results** - Fill in the Actual Status, Actual Response, Pass/Fail columns
3. **Fix Issues** - If any tests fail, fix the issues before deploying
4. **Update Date** - Record when tests were run

### Example Test Flow

```powershell
# Test booking endpoint
$body = @{
    name = "John Doe"
    email = "john@example.com"
    checkIn = "2026-02-01"
    checkOut = "2026-02-05"
} | ConvertTo-Json

$response = Invoke-RestMethod -Method POST `
    -Uri "https://grand-royal.webzyl.com/api/booking/grand-royal" `
    -ContentType "application/json" `
    -Body $body

# Check response matches expected result
# Update CSV with actual results
```

## Current Test Coverage

The CSV currently includes test cases for:

- Config Management
- Room Management
- Gallery Management
- Design Profiles
- Booking System
- Booking Workspaces
- Metrics/Analytics
- Admin Dashboard
- Template Management
- Media Management
- Public Site Display
- CEO Dashboard

## Best Practices

1. **Always test after major changes** - Don't skip regression testing
2. **Document failures clearly** - Include error messages in Notes column
3. **Keep examples realistic** - Use real-world test data
4. **Test edge cases** - Not just happy paths
5. **Update regularly** - Keep test cases current with code changes

## Integration with Development

This test tracking system is referenced in `.github/copilot-instructions.md` to ensure AI coding agents automatically add test cases when developing new features.

## Tools

You can use various tools to run tests:
- PowerShell scripts (see `tmp_debug_booking.ps1`, `tmp_call_appsscript_debug.ps1`)
- curl commands
- Postman or similar API testing tools
- Custom test scripts

## Notes

- The CSV format allows easy editing in Excel, Google Sheets, or any text editor
- Consider adding automated test scripts in the future
- Test results should be committed to track changes over time
