import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchBusesDto } from './dto/search-buses.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Public()
  @Get('buses')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search buses by source, destination, and date' })
  async searchBuses(@Query() dto: SearchBusesDto) {
    const results = await this.searchService.searchBuses(dto);
    return {
      success: true,
      message: `Found ${results.length} bus(es)`,
      data: results,
    };
  }
}
